'use strict';

var libQ = require('kew');
var libNet = require('net');
var libFast = require('fast.js');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var SpotifyWebApi = require('spotify-web-api-node');
var nodetools = require('nodetools');

module.exports = AudioIn;
function ControllerAudioIn(context) {
	// This fixed variable will let us refer to 'this' object at deeper scopes
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;

}



ControllerAudioIn.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

	return libQ.resolve();
}

ControllerAudioIn.prototype.getConfigurationFiles = function()
{
	return ['config.json'];
}

ControllerAudioIn.prototype.addToBrowseSources = function () {
	var data = {name: 'Audio in', uri: 'audioin',plugin_type:'music_service',plugin_name:'AudioIn', albumart: '/albumart?sourceicon=music_service/AudioIn/audio_in.svg'};
	this.commandRouter.volumioAddToBrowseSources(data);
};

// Plugin methods -----------------------------------------------------------------------------

ControllerAudioIn.prototype.startAudioInDaemon = function() {
	var self = this;

	var defer=libQ.defer();

	exec("/usr/bin/sudo /bin/systemctl start audioin.service", {uid:1000,gid:1000}, function (error, stdout, stderr) {
		if (error !== null) {
			self.commandRouter.pushConsoleMessage('The following error occurred while starting AudioInD: ' + error);
			defer.reject();
		}
		else {
			self.commandRouter.pushConsoleMessage('AudioInD Daemon Started');
			defer.resolve();
		}
	});

	return defer.promise;
};

ControllerAudioIn.prototype.onStop = function() {
	var self = this;

    var defer=libQ.defer();

	self.logger.info("Killing AudioInD daemon");
	exec("/usr/bin/sudo /bin/systemctl stop audioin.service", function (error, stdout, stderr) {
		if(error){
			self.logger.info('Cannot kill AudioIn Daemon')
            defer.reject();
		} else {
			defer.resolve()
		}
	});

    return defer.promise;
};

ControllerAudioIn.prototype.onStart = function() {
	var self = this;

	var defer=libQ.defer();

	self.startAudioInDaemon()
		.then(function(e)
		{
			setTimeout(function () {
				self.logger.info("Connecting to daemon");
				self.AudioInDaemonConnect(defer);
			}, 5000);
		})
		.fail(function(e)
		{
			defer.reject(new Error());
		});
	this.commandRouter.sharedVars.registerCallback('alsa.outputdevice', this.rebuildAudioInDAndRestartDaemon.bind(this));

	return defer.promise;
};

ControllerAudioIn.prototype.handleBrowseUri = function (curUri) {
	var self = this;

	//self.commandRouter.logger.info(curUri);
	var response;

	if (curUri.startsWith('audioin')) {
		if (curUri == 'audioin') {
			response = libQ.resolve({
				navigation: {
					lists: [
						{
							"availableListViews": [
								"list"
							],
							"items": [
								{
									service: 'AudioIn',
									type: 'spotify-category',
									title: 'My Playlists',
									artist: '',
									album: '',
									icon: 'fa fa-folder-open-o',
									uri: 'spotify/playlists'
								},
								{
									service: 'AudioIn',
									type: 'spotify-category',
									title: 'Featured Playlists',
									artist: '',
									album: '',
									icon: 'fa fa-folder-open-o',
									uri: 'spotify/featuredplaylists'
								},
								{
									service: 'AudioIn',
									type: 'spotify-category',
									title: 'What\'s New',
									artist: '',
									album: '',
									icon: 'fa fa-folder-open-o',
									uri: 'spotify/new'
								},
								{
									service: 'AudioIn',
									type: 'spotify-category',
									title: 'Genres & Moods',
									artist: '',
									album: '',
									icon: 'fa fa-folder-open-o',
									uri: 'spotify/categories'
								}
							]
						}
					],
					"prev": {
						uri: 'spotify'
					}
				}
			});
		}
		else if (curUri.startsWith('spotify/playlists')) {
			if (curUri == 'spotify/playlists')
				response = self.listPlaylists();
			else {
				response = self.listPlaylist(curUri);
			}
		}
		else if (curUri.startsWith('spotify/featuredplaylists')) {
			response = self.featuredPlaylists(curUri);
		}
		else if (curUri.startsWith('spotify:user:')) {
			response = self.listWebPlaylist(curUri);
		}
		else if (curUri.startsWith('spotify/new')) {
			response = self.listWebNew(curUri);
		}
		else if (curUri.startsWith('spotify/categories')) {
			response = self.listWebCategories(curUri);
		}
		else if (curUri.startsWith('spotify:album')) {
			response = self.listWebAlbum(curUri);
		}
		else if (curUri.startsWith('spotify/category')) {
			response = self.listWebCategory(curUri);
		}
		else if (curUri.startsWith('spotify:artist:')) {
			response = self.listWebArtist(curUri);
		}
	}

	return response;
};

// AudioIn stop
ControllerAudioIn.prototype.stop = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::stop');

	return self.sendAudioInCommand('stop', []);
};

ControllerAudioIn.prototype.onRestart = function() {
	var self = this;
	//
};

ControllerAudioIn.prototype.onInstall = function() {
	var self = this;
	//Perform your installation tasks here
};

ControllerAudioIn.prototype.onUninstall = function() {
	var self = this;
	//Perform your installation tasks here
};

ControllerAudioIn.prototype.getUIConfig = function() {
	var defer = libQ.defer();
	var self = this;

	var lang_code = this.commandRouter.sharedVars.get('language_code');

	self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
		__dirname+'/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
		.then(function(uiconf)
		{

			uiconf.sections[0].content[0].value = self.config.get('audiodevice');

			defer.resolve(uiconf);
		})
		.fail(function()
		{
			defer.reject(new Error());
		});

	return defer.promise;
};

ControllerAudioIn.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

ControllerAudioIn.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

ControllerAudioIn.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

// Public Methods ---------------------------------------------------------------------------------------
// These are 'this' aware, and return a promise

// AudioIn stop
ControllerAudioIn.prototype.stop = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::stop');

	return self.sendAudioInCommand('stop', []);
};

// AudioIn pause
ControllerAudioIn.prototype.pause = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::pause');

	// TODO don't send 'toggle' if already paused
	return self.sendAudioInCommand('toggle', []);
};

// AudioIn resume
ControllerAudioIn.prototype.resume = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::resume');

	// TODO don't send 'toggle' if already playing
	return self.sendAudioInCommand('toggle', []);
};

// AudioIn music library
ControllerAudioIn.prototype.getTracklist = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::getTracklist');

	return self.tracklistReady
		.then(function() {
			return self.tracklist;
		});
};

// Internal methods ---------------------------------------------------------------------------
// These are 'this' aware, and may or may not return a promise

// Send command to AudioIn
ControllerAudioIn.prototype.sendAudioInCommand = function(sCommand, arrayParameters) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::sendAudioInCommand');

	// Convert the array of parameters to a string
	var sParameters = libFast.reduce(arrayParameters, function(sCollected, sCurrent) {
		return sCollected + ' ' + sCurrent;
	}, '');


	var AudioInResponseDeferred = libQ.defer();
	// Pass the command to AudioIn when the command socket is ready
	self.AudioInCommandReady
		.then(function() {
			return libQ.nfcall(libFast.bind(self.connAudioInCommand.write, self.connAudioInCommand), sCommand + sParameters + '\n', 'utf-8')
				;
		});


	var AudioInResponse = AudioInResponseDeferred.promise;

	if(sCommand!=='status')
	{
		self.commandRouter.logger.info("ADDING DEFER FOR COMMAND " + sCommand);
		self.arrayResponseStack.push(AudioInResponseDeferred);
	}
	// Return a promise for the command response
	return AudioInResponse;
};

// AudioIn get state
ControllerAudioIn.prototype.getState = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::getState');

	return self.sendAudioInCommand('status', []);
};

// AudioIn parse state
ControllerAudioIn.prototype.parseState = function(sState) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::parseState');

	var objState = JSON.parse(sState);
	console.log(objState)

	var nSeek = null;
	if ('position' in objState) {
		nSeek = objState.position * 1000;
	}

	var nDuration = null;
	if ('duration' in objState) {
		nDuration = Math.trunc(objState.duration / 1000);
	}

	var sStatus = null;
	if ('status' in objState) {
		if (objState.status === 'playing') {
			sStatus = 'play';
		} else if (objState.status === 'paused') {
			sStatus = 'pause';
		} else if (objState.status === 'stopped') {
			sStatus = 'stop';
		}
	}

	var nPosition = null;
	if ('current_track' in objState) {
		nPosition = objState.current_track - 1;
	}

	return libQ.resolve({
		status: sStatus,
		position: nPosition,
		seek: nSeek,
		duration: nDuration,
		samplerate: self.samplerate, // Pull these values from somwhere else since they are not provided in the AudioIn state
		bitdepth: null,
		channels: null,
		artist: objState.artist,
		title: objState.title,
		album: objState.album
	});
};

// Announce updated AudioIn state
ControllerAudioIn.prototype.pushState = function(state) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::pushState');

	return self.commandRouter.servicePushState(state, self.servicename);
};

// Pass the error if we don't want to handle it
ControllerAudioIn.prototype.pushError = function(sReason) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerAudioIn::pushError(' + sReason + ')');

	// Return a resolved empty promise to represent completion
	return libQ.resolve();
};

ControllerAudioIn.prototype.getTrack = function(id) {
	var self=this;

	var defer=libQ.defer();

    var item = {
        uri: results.body.uri,
        service: 'AudioIn',
        name: results.body.name,
        artist: artist,
        album: album,
        type: 'song',
        duration: parseInt(results.body.duration_ms / 1000),
        tracknumber: results.body.track_number,
        albumart: albumart,
        samplerate: self.samplerate,
        bitdepth: '16 bit',
        trackType: 'spotify'
    };
    response.push(item);
    defer.resolve(response);

	return defer.promise;
};

ControllerAudioIn.prototype.logDone = function(timeStart) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + '------------------------------ ' + (Date.now() - timeStart) + 'ms');
	return libQ.resolve();
};

ControllerAudioIn.prototype.logStart = function(sCommand) {
	var self = this;
	self.commandRouter.pushConsoleMessage('\n' + '[' + Date.now() + '] ' + '---------------------------- ' + sCommand);
	return libQ.resolve();
};



ControllerAudioIn.prototype.createAudioInDFile = function () {
	var self = this;

	var defer=libQ.defer();


	try {

		fs.readFile(__dirname + "/AudioIn.conf.tmpl", 'utf8', function (err, data) {
			if (err) {
				defer.reject(new Error(err));
				return console.log(err);
			}
			var outdev = self.commandRouter.sharedVars.get('alsa.outputdevice');
			var hwdev = 'hw:' + outdev;
			var  bitrate = self.config.get('bitrate');
			var bitratevalue = 'true';
			if (bitrate == false ) {
				bitratevalue = 'false';
			}

			var conf1 = data.replace("${username}", self.config.get('username'));
			var conf2 = conf1.replace("${password}", self.config.get('password'));
			var conf3 = conf2.replace("${bitrate}", self.config.get('bitrate'));
			var conf4 = conf3.replace("${outdev}", hwdev);

			fs.writeFile("/etc/AudioInd.conf", conf4, 'utf8', function (err) {
				if (err)
					defer.reject(new Error(err));
				else defer.resolve();
			});


		});


	}
	catch (err) {


	}

	return defer.promise;

};

ControllerAudioIn.prototype.rebuildAudioInDAndRestartDaemon = function () {
	var self=this;
	var defer=libQ.defer();

	self.createAudioInDFile()
		.then(function(e)
		{
			var edefer=libQ.defer();
			exec("killall audiodaemon", function (error, stdout, stderr) {
				edefer.resolve();
			});
			return edefer.promise;
		})
		.then(self.startAudioInDaemon.bind(self))
		.then(function(e)
		{
			setTimeout(function () {
				self.logger.info("Connecting to daemon");
				self.AudioInDaemonConnect(defer);
			}, 5000);
		});

	return defer.promise;
};

ControllerAudioIn.prototype._getInputs = function (results) {

	var list = [];

    list.push({
        service: 'AudioIn',
        type: 'song',
        title: track.name,
        artist: track.artists[0].name,
        album: track.album.name,
        albumart: albumart,
        uri: ""
    });

	return list;
};
