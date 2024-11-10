'use strict';
const path = require('path');
const fs = require('fs');
const Zone = require('./src/zone.js');
const Utils = require('./src/utils.js');
const Russound = require('russound-aio');
const CONSTANTS = require('./src/constants.json');

class RussoundAIOPlatform {
	constructor(log, config, api) {
		this.log = log;
		this.api = api;

		this.accessories = [];
		this.zones = [];
		this.controllerId = 1;

		this.config = config;
		this.controllerName = config?.name;
		this.host = config?.host;
		this.port = config?.port;

		// only load if configured
		if (!config || !this.controllerName || !this.host || !this.port) {
			log.warn(`No configuration found for ${CONSTANTS.PluginName}`);
			log.warn(`Name: ${this.controllerName ? 'OK' : this.controllerName}, host: ${this.host ? 'OK' : this.host}, port: ${this.port ? 'OK' : this.port}}, in config wrong or missing.`);
			return;
		}

		//check if prefs directory exist
		const prefDir = path.join(api.user.storagePath(), CONSTANTS.PlatformName.toLowerCase());
		try {
			fs.mkdirSync(prefDir, { recursive: true });
		} catch (error) {
			log.error(`Prepare directory error: ${error.message ?? error}`);
			return;
		}

		//debug config
		this.enableDebugMode = config?.enableDebugMode || false;
		this.debugLog(`Controller: ${this.host} ${this.controllerName}, Config: ${Utils.objectToJsonString(config)}`);

		this.api.on('didFinishLaunching', async () => {
            try {
				this.debugLog(`Controller: ${this.host} ${this.controllerName}, did finish launching.`);
				//await new Promise(resolve => setTimeout(resolve, 500));

				const connection = new Russound.RussoundTcpConnectionHandler(this.host, this.port, this.log, this.config)
				const russound = new Russound.RussoundClient(connection, this.log, this.config)

				await russound.registerStateUpdateCallbacks(this.onStateChange);
				await russound.connect();

				const sourcesData = this.configuredSources(russound.sources);
				const inputsFile = `${prefDir}/inputs_C${this.controllerId}${this.host.split('.').join('')}`;

				const createFiles = Utils.createFiles(this.log, [inputsFile]);

				if (!createFiles)
					return;

				await Utils.saveData(inputsFile, sourcesData);

				const controller = russound.controllers[this.controllerId];
				const { zones, ...commonConfig } = this.config;

				for (const [zoneId, zone] of Object.entries(controller.zones)) {
					try {
						this.debugLog(`Adding Zone: ${zoneId} - ${zone.name}`);
						//check files exists, if not then create it
						const postFix = `${zone.deviceStr.replace(/[\[\].']+/g,'')}${this.host.split('.').join('')}`;
						const devInfoFile = `${prefDir}/devInfo_${postFix}`;
						const inputsNamesFile = `${prefDir}/inputsNames_${postFix}`;
						const inputsTargetVisibilityFile = `${prefDir}/inputsTargetVisibility_${postFix}`;

						const createFiles = Utils.createFiles(this.log, [
								devInfoFile,
								inputsNamesFile,
								inputsTargetVisibilityFile,
						], `Zone: ${zone.name}`);
		
						if (!createFiles)
							return;

						const zoneConfig = zones?.find(zone => zone.id === zoneId) ?? { id: zoneId };
						const config = { 
							...commonConfig,
							name: zone.name,
							...zoneConfig,
							devInfoFile, 
							inputsNamesFile, 
							inputsTargetVisibilityFile 
						};

						this.debugLog(`Zone: ${zone.name}, debug: config: ${Utils.objectToJsonString(config)}`);					 
						const zoneAccessory = new Zone(api, controller, config);

						this.zones.push (
							{
								id: zoneId,
								accessory: zoneAccessory
							}
						);
						zoneAccessory.on('publishAccessory', (accessory) => {
							try {
								this.api.publishExternalAccessories(CONSTANTS.PluginName, [accessory]);
								this.configureAccessory(accessory);
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
							this.debugLog(`Zone: ${zone.name}, debug: ${debug}`);
						}).on('warn', (warn) => {
							this.log.warn(`Zone: ${zone.name}, ${warn}`);
						}).on('error', async (error) => {
							this.log.error(`Zone: ${zone.name}, ${error}`);
						});
						await zoneAccessory.start(sourcesData);
					} catch (error) {
						this.log.error(`Zone: ${zone.name}, did finish launching error: ${error}`);
						return;
					}
				}
			} catch (error) {
				this.log.error(`Did finish launching error: ${error}`);	
				return;
			} 
		});
	}

    configuredSources = (sources) => {
		const sourcesData = [];
		for (const [sourceId, source] of Object.entries(sources)) {
			if (source.type != '')
			{
				sourcesData.push(this.sourceData(source, sourceId))
			}
		}	
		return sourcesData;
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
		  if (callbackType === "state")
		  {
			const sourcesData = this.configuredSources(client.sources);

			const controller = client.controllers[1];
			//notify zones of state change
			for (const zone of this.zones) {
				let data = zoneData(controller.zones[zone.id]);
				zone.accessory.onStateChange(data, sourcesData);
			}
  		  }

		} catch (error) {
			this.log.error(`onStateChange: error: ${error}`);
		}
	} 


    configureAccessory = (platformAccessory) => {
       // this.accessories.push(platformAccessory);
    }
    
	removeAccessory = (platformAccessory) => {
	  	this.api.unregisterPlatformAccessories(CONSTANTS.PluginName, CONSTANTS.PlatformName, [platformAccessory]);
	}

	debugLog = (msg) => {
		if (this.enableDebugMode) this.log.info(msg);
	}
};

module.exports = (api) => {
	api.registerPlatform(CONSTANTS.PluginName, CONSTANTS.PlatformName, RussoundAIOPlatform, true);
};