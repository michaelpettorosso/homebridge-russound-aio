'use strict';
const path = require('path');
const fs = require('fs');
const Zone = require('./src/zone.js');
const Russound = require('russound-aio');
const CONSTANTS = require('./src/constants.json');

class RussoundAIOPlatform {
	constructor(log, config, api) {
		// only load if configured
		if (!config) { //|| !Array.isArray(config.devices)
			log.warn(`No configuration found for ${CONSTANTS.PluginName}`);
			return;
		}
		this.accessories = [];
		this.zones = [];
		this.controllerId = 1;
		this.controllerName = config.name;
		this.host = config.host;
		this.port = config.port;
		this.log = log;
		this.api = api;
		this.config = config;

		//check if prefs directory exist
		const prefDir = path.join(api.user.storagePath(), 'russound-aio');
		try {
			fs.mkdirSync(prefDir, { recursive: true });
		} catch (error) {
			this.log.error(`Prepare directory error: ${error.message ?? error}`);
			return;
		}

		this.enableDebugMode = config.enableDebugMode || false;

		this.api.on('didFinishLaunching', async () => {
			if (!this.controllerName || !this.host || !this.port) {
				this.log.warn(`Name: ${this.controllerName ? 'OK' : this.controllerName}, host: ${this.host ? 'OK' : this.host}, port: ${this.port ? 'OK' : this.port}}, in config wrong or missing.`);
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 500));

			//debug config

			this.debugLog(`Controller: ${this.host} ${this.controllerName}, did finish launching.`);

			this.debugLog(`Controller: ${this.host} ${this.controllerName}, Config: ${JSON.stringify(config, null, 2)}`);

			const connection = new Russound.RussoundTcpConnectionHandler(this.host, this.port, this.log, this.config)
			const russound = new Russound.RussoundClient(connection, this.log, this.config)

			await russound.registerStateUpdateCallbacks(this.onStateChange);
			await russound.connect();

			const sourcesData = [];
			for (const [s_id, source] of Object.entries(russound.sources)) {
				this.debugLog(`Found Source: ${s_id} - ${source.name}${source.type != '' ? " (" + source.type + ")" : ""}`);
				if (source.type != '')
					sourcesData.push(this.sourceData(source, s_id))
			}	

			const controller = russound.controllers[this.controllerId];
			for (const [z_id, zone] of Object.entries(controller.zones)) {
				try {
					this.debugLog(`Found Zone: ${z_id} - ${zone.name}`);
					// //check files exists, if not then create it
					const postFix = `${zone.deviceStr.replace(/[\[\].']+/g,'')}${this.host.split('.').join('')}`
					const devInfoFile = `${prefDir}/devInfo_${postFix}`;
					const inputsFile = `${prefDir}/inputs_${postFix}`;
					const inputsNamesFile = `${prefDir}/inputsNames_${postFix}`;
					const inputsTargetVisibilityFile = `${prefDir}/inputsTargetVisibility_${postFix}`;

					try {
						const files = [
							devInfoFile,
							inputsFile,
							inputsNamesFile,
							inputsTargetVisibilityFile,
						];

						files.forEach((file) => {
							if (!fs.existsSync(file)) {
								fs.writeFileSync(file, '');
							}
						});
					} catch (error) {
						this.log.error(`Controller: ${this.host} ${this.controllerName}, prepare files error: ${error}`);
						return;
					}

					const zoneAccessory = new Zone(api, config, controller, z_id, devInfoFile, inputsFile, inputsNamesFile, inputsTargetVisibilityFile);

					this.zones.push (
						{
							id: z_id,
							zoneAccessory: zoneAccessory
						}
					);
					zoneAccessory.on('publishAccessory', (accessory) => {
						try {
							this.api.publishExternalAccessories(CONSTANTS.PluginName, [accessory]);
							this.log.success(`Device: ${controller?.controllerType} ${zone.name}, published as external accessory.`);
						} catch (error) {
							this.log.error(`Zone: ${zone.name}, ${error}`);
						}
					}).on('devInfo', (devInfo) => {
						this.log.warn(`Zone: ${zone.name}, ${devInfo}`);
					}).on('success', (message) => {
						this.log.success(`Zone: ${zone.name}, ${message}`);
					}).on('message', (message) => {
						this.log.info(`Zone: ${zone.name}, ${message}`);
					}).on('debug', (debug) => {
						this.log.info(`Zone: ${zone.name}, debug: ${debug}`);
					}).on('warn', (warn) => {
						this.log.warn(`Zone: ${zone.name}, ${warn}`);
					}).on('error', async (error) => {
						this.log.error(`Zone: ${zone.name}, ${error}`);
					});
					await zoneAccessory.start(sourcesData);
					
				} catch (error) {
					this.log.error(`Zone: ${zone.name}, did finish launching error: ${error}`);
				}
			}


		});
	}

	sourceData = ({ name, mode, playStatus }, currentSource) => {
		return {
			name,
			mode,
			playStatus,
			identifier: parseInt(currentSource, 10)
		}
	}

	onStateChange = async (client, callbackType) => {
		const zoneData = ({ status, volume, mute, currentSource }) => {
			return {
				status,
				volume,
				mute,
				currentSource
			}
		}
	

		try {
		  this.debugLog(`Controller: onStateChange: callbackType: ${callbackType}`);
		  if (callbackType === "state")
		  {
			const sourcesData = [];
            for (const [s_id, source] of Object.entries(client.sources)) {
				if (source.type != '')
					sourcesData.push(this.sourceData(source, s_id))
			}

			const controller = client.controllers[1];
			for (const zone of this.zones) {
				zone.zoneAccessory.onStateChange(zoneData(controller.zones[zone.id]), sourcesData)
			}
  		  }

		} catch (error) {
			this.log.error(`onStateChange: error: ${error}`);
		}

	
	} 

	configureAccessory = (accessory) => {
		this.accessories.push(accessory);
	}

	debugLog = (msg) => {
		if (this.enableDebugMode) this.log.info(msg);
	}
};

module.exports = (api) => {
	api.registerPlatform(CONSTANTS.PluginName, CONSTANTS.PlatformName, RussoundAIOPlatform, true);
};