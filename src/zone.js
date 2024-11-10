'use strict';
const EventEmitter = require('events');
const CONSTANTS = require('./constants.json');
const Utils = require('./utils.js');

let Accessory, Characteristic, Service, Categories, Encode, AccessoryUUID;

const BUTTON_RESET_TIMEOUT = 20; // in milliseconds
const MAX_VOLUME = 50; 

const SENSOR_TYPES = [
    'Input',
    'Mute',
    'Power',
    'Volume'
]

class Zone extends EventEmitter {
    constructor(api, controller, config) {
        super();

        Accessory = api.platformAccessory;
        Characteristic = api.hap.Characteristic;
        Service = api.hap.Service;
        Categories = api.hap.Categories;
        Encode = api.hap.encode;
        AccessoryUUID = api.hap.uuid;

        //device configuration
        this.controller = controller;
        this.zoneId = config.id;
        this.zone = this.controller.zones[this.zoneId];

        //device information
        this.manufacturer = this.controller?.manufacturer || 'Russound';
        this.modelName = `${this.controller.controllerType}-Zone-${this.zoneId}`;
        this.serialNumber = `${this.zone.deviceStr.replace(/[\[\].']+/g,'')}`;
        this.firmwareRevision = this.controller.firmwareVersion;
        this.macAddress = this.controller.macAddress;
        this.apiVersion = this.controller.client.rioVersion;
        
        //configured name
        const nameSuffix = config?.zoneNameSuffix || '';
        const name = (config?.name?.replace('/',' ') || `Zone ${this.zoneId}`);
        this.name = `${name} ${nameSuffix}`.trim();
        
        this.addRemote = config?.addRemote || false;

        //logging flags
        this.enableDebugMode = config?.enableDebugMode || false;
        this.disableLogInfo = config?.disableLogInfo || true;
        this.disableLogDeviceInfo = config?.disableLogDeviceInfo || true;

        //sensor settings
        this.sensorPower = config?.sensorPower || false;
        this.sensorVolume = config?.sensorVolume || false
        this.sensorMute = config?.sensorMute || false;
        this.sensorInput = config?.sensorInput || false;

        this.sensorVolumeState = false;
        this.sensorInputState = false;

        //volume settings
        this.volumeControlNamePrefix = config?.volumeControlNamePrefix || false;
        this.volumeControlName = config?.volumeControlName || 'Volume';
        this.volumeControl = config?.volumeControl || 1;
        this.volumeMax = config?.volumeMax || MAX_VOLUME;

        //files
        this.devInfoFile = config.devInfoFile;
        this.inputsNamesFile = config.inputsNamesFile;
        this.inputsTargetVisibilityFile = config.inputsTargetVisibilityFile;

        //services
        this.allServices = [];

        //input settings
        this.inputs = config?.sources || [];
        this.inputsDisplayOrder = config?.inputsDisplayOrder || 0;
        this.getInputsFromDevice = config?.getInputsFromDevice || false;
        this.inputsConfigured = [];
        this.inputIdentifier = 1;

        // //buttons settings
        // this.buttons = config?.buttons || [];
        // this.buttonsConfigured = [];
        // for (const button of this.buttons) {
        //     const buttonName = button.name ?? false;
        //     const buttonReference = button.reference ?? false;
        //     const buttonDisplayType = button.displayType ?? 0;
        //     if (buttonName && buttonReference && buttonDisplayType > 0) {
        //         button.serviceType = ['', Service.Outlet, Service.Switch][buttonDisplayType];
        //         button.state = false;
        //         this.buttonsConfigured.push(button);
        //     } else {
        //         const log = buttonDisplayType === 0 ? false : this.log(`Button Name: ${buttonName ? buttonName : 'Missing'}, Reference: ${buttonReference ? buttonReference : 'Missing'}.`);
        //     };
        // }
        // this.buttonsConfiguredCount = this.buttonsConfigured.length || 0;

        //state variables
        this.startPrepareAccessory = true;

        this.power = false;
        this.volume = 0;
        this.muted = true;
        this.mediaState = false;
    };

    onStateChange = async (zone, sources) => {
        try {
            this.debugLog(`onStateChange: ${Utils.objectToJsonString(zone)}`);

            const { status, volume, mute, currentSource } = zone;
            const power = status === 'ON';
            const mutedState = power ? mute === 'ON' : true;
            const powerState = power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;

            const input = this.inputsConfigured.find(input => input.identifier == parseInt(currentSource, 10)) ?? false;
            const inputIdentifier = input ? input.identifier : this.inputIdentifier;
            if (this.televisionService) {
                this.televisionService
                .updateCharacteristic(Characteristic.Active, powerState)
                .updateCharacteristic(Characteristic.ActiveIdentifier, inputIdentifier);
            }
 
            if (this.speakerService) {
                const volumeValue = this.getScaledVolume(volume);
                this.speakerService
                .updateCharacteristic(Characteristic.Active, powerState)
                .updateCharacteristic(Characteristic.Volume, volumeValue)
                .updateCharacteristic(Characteristic.Mute, mutedState);

                if (this.volumeService) {
                    this.volumeService
                        .updateCharacteristic(Characteristic.Brightness, volumeValue)
                        .updateCharacteristic(Characteristic.On, !mutedState);
                }

                if (this.volumeServiceFan) {
                    this.volumeServiceFan
                        .updateCharacteristic(Characteristic.RotationSpeed, volumeValue)
                        .updateCharacteristic(Characteristic.On, !mutedState);
                }
            }

            //sensors
            if (this.sensorPowerService) {
                const state = power ;
                this.sensorPowerService.updateCharacteristic(Characteristic.ContactSensorState, this.contactSensorState(state))
            }

            if (volume !== this.volume) {
                for (let i = 0; i < 2; i++) {
                    const state = (power ? [true, false][i] : false);
                    if (this.sensorVolumeService) {
                        this.sensorVolumeService.updateCharacteristic(Characteristic.ContactSensorState, this.contactSensorState(state))
                        this.sensorVolumeState = state;
                    }
                }
            }

            if (this.sensorMuteService) {
                const state = mutedState;
                this.sensorMuteService.updateCharacteristic(Characteristic.ContactSensorState, this.contactSensorState(state));
            }

            if (inputIdentifier !== this.inputIdentifier) {
                for (let i = 0; i < 2; i++) {
                    const state = power ? [true, false][i] : false;
                    if (this.sensorInputService) {
                        this.sensorInputService.updateCharacteristic(Characteristic.ContactSensorState, this.contactSensorState(state)); 
                        this.sensorInputState = state;
                    }
                }
            }

            // //buttons
            // if (this.buttonsConfiguredCount > 0) {
            //     for (let i = 0; i < this.buttonsConfiguredCount; i++) {
            //         const button = this.buttonsConfigured[i];
            //         const state = this.power ? button.reference === reference : false;
            //         button.state = state;
            //         if (this.buttonsServices) {
            //             this.buttonsServices[i]
            //                 .updateCharacteristic(Characteristic.On, state);
            //         }
            //     }
            // }

            this.inputIdentifier = inputIdentifier;
            this.power = power;
            this.volume = volume;
            this.muted = mutedState;
    
            const name = input ? input.name : inputIdentifier;
            this.infoLog(`Power: ${power ? 'ON' : 'OFF'}`);
            this.infoLog(`Input Name: ${name}`);
            this.infoLog(`Input Identifier: ${inputIdentifier}`);
            this.infoLog(`Volume: ${volume}`);
            this.infoLog(`Mute: ${mutedState ? 'ON' : 'OFF'}`);
        } catch (error) {
            throw new Error(`onStateChange error: ${error.message || error}.`);
        };
    }

    contactSensorState = (state) => {
        return state ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
    }

    start = async(sources) => {
        try {
            if (this.startPrepareAccessory)
            {
                //read inputs names from file
                const savedInputsNames = await Utils.readData(this.inputsNamesFile);
                this.savedInputsNames = savedInputsNames.toString().trim() !== '' ? JSON.parse(savedInputsNames) : {};
                this.debugLog(`Read saved Inputs Names: ${Utils.objectToJsonString(this.savedInputsNames)}`);
    
                //read inputs visibility from file
                const savedInputsTargetVisibility = await Utils.readData(this.inputsTargetVisibilityFile);
                this.savedInputsTargetVisibility = savedInputsTargetVisibility.toString().trim() !== '' ? JSON.parse(savedInputsTargetVisibility) : {};
                this.debugLog(`Read saved Inputs Target Visibility: ${Utils.objectToJsonString(this.savedInputsTargetVisibility)}`);
            }

            if (this.enableDebugMode) 
            {
                this.devInfoLog(`Logging: enableDebugMode: ${this.enableDebugMode}`);
                this.devInfoLog(`Logging: disableLogInfo: ${this.disableLogInfo}`);
                this.devInfoLog(`Logging: disableLogDeviceInfo: ${this.disableLogDeviceInfo}`);

                this.devInfoLog(`Add Remote: ${this.addRemote}`);

                this.devInfoLog(`Sensor: sensorPower: ${this.sensorPower}`);
                this.devInfoLog(`Sensor: sensorVolume: ${this.sensorVolume}`);
                this.devInfoLog(`Sensor: sensorMute: ${this.sensorMute}`);
                this.devInfoLog(`Sensor: sensorInput: ${this.sensorInput}`);

                this.devInfoLog(`Volume: volumeControlNamePrefix: ${this.volumeControlNamePrefix}`);
                this.devInfoLog(`Volume: volumeControlName: ${this.volumeControlName}`);
                this.devInfoLog(`Volume: volumeControl: ${this.volumeControl}`);
                this.devInfoLog(`Volume: volumeMax: ${this.volumeMax}`);

                this.devInfoLog(`File: devInfoFile: ${this.devInfoFile}`);
                this.devInfoLog(`File: inputsNamesFile: ${this.inputsNamesFile}`);
                this.devInfoLog(`File: inputsTargetVisibilityFile: ${this.inputsTargetVisibilityFile}`);
            }

            //save device info
            const saveDevInfo = await Utils.saveData(this.devInfoFile, 
            { 
                name: this.name,
                manufacturer: this.manufacturer,
                modelName: this.modelName,
                control: `Zone ${this.zone.name}`,
                zoneId: this.zoneId,
                macAddress: this.macAddress,
                firmware: this.firmwareRevision,
                apiVersion: this.apiVersion,
                serialNumber: this.serialNumber
            });
            
            if (!this.disableLogDeviceInfo) 
            {
                this.devInfoLog(`-------- ${this.name} --------`);
                this.devInfoLog(`Manufacturer: ${this.manufacturer}`);
                this.devInfoLog(`Model: ${this.modelName}`);
                this.devInfoLog(`Control: ${this.zone.name}`);
                this.devInfoLog(`Zone Id: ${this.zoneId}`);
                this.devInfoLog(`MAC Address: ${this.macAddress}`);
                this.devInfoLog(`Firmware: ${this.firmwareRevision}`);
                this.devInfoLog(`Api Version: ${this.apiVersion}`);
                this.devInfoLog(`Serial Number: ${this.serialNumber}`);
                this.devInfoLog(`----------------------------------`);
            }

            if (!this.disableLogInfo) 
            {
                this.devInfoLog(`Power: ${this.power}`);
                this.devInfoLog(`Volume: ${this.volume}`);
                this.devInfoLog(`Muted: ${this.muted}`);
                this.devInfoLog(`Media State: ${this.mediaState}`);
            }

            if (this.startPrepareAccessory) 
            {
                const accessory = this.prepareAccessory(sources);
                const sortInputsDisplayOrder = this.televisionService ? await this.displayOrder() : false;
                this.emit('publishAccessory', accessory);
            }    
            this.startPrepareAccessory = false;
            return true;
        } catch (error) {
            throw new Error(`Start error: ${error.message || error}.`);
        };
    };

    displayOrder = async() => {
        try {
            switch (this.inputsDisplayOrder) {
                case 0:
                    this.inputsConfigured.sort((a, b) => a.identifier - b.identifier);
                    break;
                case 1:
                    this.inputsConfigured.sort((a, b) => a.name.localeCompare(b.name));
                    break;
                case 2:
                    this.inputsConfigured.sort((a, b) => b.name.localeCompare(a.name));
                    break;
            }
            this.debugLog(`Inputs display order: ${Utils.objectToJsonString(this.inputsConfigured)}`);

            const displayOrder = this.inputsConfigured.map(input => input.identifier);
            this.televisionService.setCharacteristic(Characteristic.DisplayOrder, Encode(1, displayOrder).toString('base64'));
            return true;
        } catch (error) {
            throw new Error(`Display order error: ${error.message || error}`);
        };
    }

    getVolumeMax = () =>
    {
        return this.getScaledVolume(this.volumeMax || MAX_VOLUME);
    }

    getScaledVolume = (volume) =>
    {
        return parseInt(volume, 10) * 2;
    }

    getSetVolume = (volume) =>
    {
        return  Math.round(volume / 2);
    }

    //prepare accessory
    prepareAccessory = (allSources) => {
        try {
            
            //accessory
            this.debugLog(`Prepare accessory`);
            const accessoryUUID = AccessoryUUID.generate(this.serialNumber);
            const accessoryCategory = Categories.AUDIO_RECEIVER;
            this.accessory = new Accessory(this.name, accessoryUUID, accessoryCategory);

            this.updateInformationService();
            this.prepareTvService(allSources);
            this.prepareVolumeService();
            this.prepareSensorServices();
            this.prepareButtonServices();

            return this.accessory;
        } catch (error) {
            throw new Error(error)
        };
    }

    updateInformationService = () => {
        //information service
        this.debugLog(`Prepare information service`);

        // remove the preconstructed information service, since i will be adding my own
        this.accessory.removeService(this.accessory.getService(Service.AccessoryInformation));
    
        // add my own information service
        this.informationService = new Service.AccessoryInformation();
        this.informationService
          .setCharacteristic(Characteristic.Name, this.name)
          .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
          .setCharacteristic(Characteristic.Model, this.modelName)
          .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)
          .setCharacteristic(Characteristic.FirmwareRevision, this.firmwareRevision);
        // this.informationService.addOptionalCharacteristic(Characteristic.ConfiguredName);
        // this.informationService.setCharacteristic(Characteristic.ConfiguredName, this.name);  
        this.informationService.addOptionalCharacteristic(Characteristic.HardwareRevision);
        this.informationService.setCharacteristic(Characteristic.HardwareRevision, this.macAddress);  
        this.informationService.addOptionalCharacteristic(Characteristic.SoftwareRevision);
        this.informationService.setCharacteristic(Characteristic.SoftwareRevision, this.apiVersion);  
        this.addService(this.informationService);
      }
    
    prepareTvService = (allSources) => {
        //prepare television service
        this.debugLog(`Prepare television service`);
        this.televisionService = new Service.Television(this.name, 'televisionService');
        this.televisionService.setCharacteristic(Characteristic.ConfiguredName, this.name);
        this.televisionService.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
        this.televisionService.getCharacteristic(Characteristic.Active)
            .onSet(async (state) => {
                const power = (state === Characteristic.Active.ACTIVE ? true : false);
                if (this.power == power) {
                    return;
                }

                try {
                    if (power)
                        await this.zone.zoneOn();
                    else
                        await this.zone.zoneOff();

                    this.infoLog(`set Power: ${power ? 'ON' : 'OFF'}`);
                } catch (error) {
                    this.warnLog(`set Power error: ${error}`);
                };
            });

        this.televisionService.getCharacteristic(Characteristic.ActiveIdentifier)
            .onSet(async (activeIdentifier) => {
                try {
                    const input = this.inputsConfigured.find(input => input.identifier === activeIdentifier);
                    const inputName = input.name;

                    switch (this.power) {
                        case false:
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            const tryAgain = this.power ? this.televisionService.setCharacteristic(Characteristic.ActiveIdentifier, activeIdentifier) : false;
                            break;
                        case true:
                            await this.zone.selectSource(input.identifier);
                            this.infoLog(`set Input Name: ${inputName}, Identifier: ${input.identifier}`);
                            break;
                    }
                } catch (error) {
                    this.warnLog(`set Input error: ${error}`);
                };
            });
        if (this.addRemote === true)    
            this.televisionService.getCharacteristic(Characteristic.RemoteKey)
                .onSet(async (command) => {
                    try {
                        switch (command) {
                            // case Characteristic.RemoteKey.REWIND:
                            //     command = 'rew';
                            //     break;
                            // case Characteristic.RemoteKey.FAST_FORWARD:
                            //     command = 'ff';
                            //     break;
                            case Characteristic.RemoteKey.NEXT_TRACK:
                                command = 'Next';
                                await this.zone.next();
                                break;
                            case Characteristic.RemoteKey.PREVIOUS_TRACK:
                                command = 'Previous';
                                await this.zone.previous();
                                break;
                            case Characteristic.RemoteKey.ARROW_UP:
                                command = 'MenuUp';
                                await this.zone.keyPress(command);
                                break;
                            case Characteristic.RemoteKey.ARROW_DOWN:
                                command = 'MenuDown';
                                await this.zone.keyPress(command);
                                break;
                            case Characteristic.RemoteKey.ARROW_LEFT:
                                command = 'MenuLeft';
                                await this.zone.keyPress(command);
                                break;
                            case Characteristic.RemoteKey.ARROW_RIGHT:
                                command = 'MenuRight';
                                await this.zone.keyPress(command);
                                break;
                            case Characteristic.RemoteKey.SELECT:
                                command = 'Enter';
                                await this.zone.keyPress(command);
                                break;
                            case Characteristic.RemoteKey.BACK:
                                command = 'Exit';
                                await this.zone.keyPress(command);
                                break;
                            case Characteristic.RemoteKey.EXIT:
                                command = 'Exit';
                                await this.zone.keyPress(command);
                                break;
                            case Characteristic.RemoteKey.PLAY_PAUSE:
                                this.mediaState = !this.mediaState;
                                if (this.mediaState)
                                {
                                    command = 'Play';
                                    await this.zone.play();
                                }
                                else
                                {
                                    command = 'Pause';
                                    await this.zone.pause();
                                }
                                break;
                            case Characteristic.RemoteKey.INFORMATION:
                                command = 'Info';
                                await this.zone.keyPress(command);
                                break;
                        }
                        this.infoLog(`set Remote Key: ${command}`);
                    } catch (error) {
                        this.warnLog(`set Remote Key error: ${error}`);
                    };
                });    
        this.addService(this.televisionService);
        this.prepareTvSpeakerService();
        this.prepareInputSourcesService(allSources);
    }

    prepareTvSpeakerService = () => {
        //prepare speaker service
        this.debugLog(`Prepare speaker service`);
        const serviceName = `${this.name} ${this.volumeControlName}`;

        this.speakerService = new Service.TelevisionSpeaker(serviceName, 'speakerService');
        this.speakerService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
        this.speakerService.getCharacteristic(Characteristic.Active)
            .onSet(async (state) => {
            });
        this.speakerService.getCharacteristic(Characteristic.VolumeControlType)
            .onGet(async () => {
                const state = Characteristic.VolumeControlType.ABSOLUTE;
                return state;
            })
        this.speakerService.getCharacteristic(Characteristic.VolumeSelector)
            .onSet(async (command) => {
                try {
                    switch (command) {
                        case Characteristic.VolumeSelector.INCREMENT:
                            command = 'volumeUp';
                            await this.zone.volumeUp();
                            break;
                        case Characteristic.VolumeSelector.DECREMENT:
                            command = 'volumeDown';
                            await this.zone.volumeDown();
                            break;
                    }

                    this.infoLog(`set Volume Selector: ${command}`);
                } catch (error) {
                    this.warnLog(`set Volume Selector error: ${error}`);
                };
            });

        this.speakerService.getCharacteristic(Characteristic.Volume)
            .setProps({
                minValue: 0,
                maxValue: this.getVolumeMax()
            })

            .onSet(async (value) => {
                try {
                    await this.zone.setVolume(this.getSetVolume(value));
                    this.infoLog(`set Volume: ${value}`);
                } catch (error) {
                    this.warnLog(`set Volume error: ${error}`);
                };
            });

        this.speakerService.getCharacteristic(Characteristic.Mute)
            .onSet(async (state) => {
                try {
                    if (state)
                        await this.zone.zoneMute();
                    else
                        await this.zone.zoneUnmute();
                    this.muted = state;
                    const info = this.infoLog(`set Mute: ${state ? 'ON' : 'OFF'}`);
                } catch (error) {
                    this.warnLog(`set Mute error: ${error}`);
                };
            });

        this.televisionService.addLinkedService(this.speakerService);
        this.addService(this.speakerService);
    }  

    prepareInputSourcesService = (allSources) => {
        //prepare inputs service
        this.debugLog(`Prepare input sources service`);

        const sources = [];
        for (const source of allSources) {
            if (this.inputs.length === 0 || (this.inputs.includes(source.name)))  
                sources.push(source)
        }

        this.debugLog(`Zone ${this.zoneId} Sources ${Utils.objectToJsonString(sources)} All Sources ${Utils.objectToJsonString(allSources)}`);

        //check possible inputs count (max 85)
        const inputs = sources;
        const inputsCount = inputs.length;
        const possibleInputsCount = 85 - this.allServices.length;
        const maxInputsCount = inputsCount >= possibleInputsCount ? possibleInputsCount : inputsCount;
        for (let i = 0; i < maxInputsCount; i++) {
            //input
            let input = inputs[i];
            let inputIdentifier = input.identifier;
            //get input name
            input.name = this.savedInputsNames[inputIdentifier] || input.name;

            //get visibility
            const visible = this.savedInputsTargetVisibility[inputIdentifier] || Characteristic.CurrentVisibilityState.SHOWN;

            //input service
            const inputService = new Service.InputSource(input.name, `Input ${inputIdentifier}`);
            inputService
                .setCharacteristic(Characteristic.Name, input.name)
                .setCharacteristic(Characteristic.ConfiguredName, input.name)
                .setCharacteristic(Characteristic.Identifier, inputIdentifier)
                .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
                .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER)
                .setCharacteristic(Characteristic.CurrentVisibilityState, visible);

            inputService.getCharacteristic(Characteristic.ConfiguredName)
                .onSet(async (value) => {
                    if (value == this.savedInputsNames[inputIdentifier]) {
                        return;
                    }

                    try {
                        this.savedInputsNames[inputIdentifier] = value;
                        await Utils.saveData(this.inputsNamesFile, this.savedInputsNames);

                        const input = this.inputsConfigured.find(input => input.identifier == inputIdentifier);
                        if (input)
                            input.name = value;
                        this.debugLog(`Saved Input Name: ${value}, Input Identifier: ${inputIdentifier}`);

                        //sort inputs
                        await this.displayOrder();
                    } catch (error) {
                        this.warnLog(`save Input Name error: ${error}`);
                    }
                });

            inputService.getCharacteristic(Characteristic.TargetVisibilityState)
                .onSet(async (state) => {
                    if (state === this.savedInputsTargetVisibility[inputIdentifier]) {
                        return;
                    }

                    try {
                        this.savedInputsTargetVisibility[inputIdentifier] = state;
                        await Utils.saveData(this.inputsTargetVisibilityFile, this.savedInputsTargetVisibility);
                        this.debugLog(`Saved Input: ${input.name} Target Visibility: ${state ? 'HIDEN' : 'SHOWN'}`);
                    } catch (error) {
                        this.warnLog(`save Input Target Visibility error: ${error}`);
                    }
                });

            this.inputsConfigured.push(input);
            this.televisionService.addLinkedService(inputService);
            this.addService(inputService);
        };
    }

    prepareVolumeService = () => {
            //prepare volume service
        if (this.volumeControl) {
            this.debugLog(`Prepare volume service`);
            const serviceName = this.volumeControlNamePrefix ? `${this.name} ${this.volumeControlName}` : this.volumeControlName;
            if (this.volumeControl === 1) {
                this.volumeService = new Service.Lightbulb(serviceName, 'volumeService');
                this.volumeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.volumeService.setCharacteristic(Characteristic.ConfiguredName, serviceName);  
                this.volumeService.getCharacteristic(Characteristic.Brightness)
                    .setProps({
                        minValue: 0,
                        maxValue: this.getVolumeMax()
                    })
                    .onSet(async (volume) => {
                        this.speakerService.setCharacteristic(Characteristic.Volume, volume);
                    });
                this.volumeService.getCharacteristic(Characteristic.On)
                    .onGet(() => {
                        return !this.muted;
                    })
                    .onSet(async (state) => {
                        this.speakerService.setCharacteristic(Characteristic.Mute, !state);
                    });

                this.addService(this.volumeService);
            }

            if (this.volumeControl === 2) {
                this.volumeServiceFan = new Service.Fanv2(serviceName, 'volumeService');
                this.volumeServiceFan.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.volumeServiceFan.setCharacteristic(Characteristic.ConfiguredName, serviceName);  

                this.volumeServiceFan.getCharacteristic(Characteristic.RotationSpeed)
                    .setProps({
                        minValue: 0,
                        maxValue: this.getVolumeMax()
                    })
                    .onSet(async (volume) => {
                        this.speakerService.setCharacteristic(Characteristic.Volume, volume);
                    });
                this.volumeServiceFan.getCharacteristic(Characteristic.On)
                    .onSet(async (state) => {
                        this.speakerService.setCharacteristic(Characteristic.Mute, !state);
                    });

                this.addService(this.volumeServiceFan)
            }

            this.debugLog(`Prepare Stateless Switch services`);
            this.volumeUpService = this.createStatelessSwitchService('Volume Up', 'volumeUpService', this.setVolumeUp);
            this.addService(this.volumeUpService);

            this.volumeDownService = this.createStatelessSwitchService('Volume Down', 'volumeDownService', this.setVolumeDown);
            this.addService(this.volumeDownService);
        };
    }

    prepareSensorServices = () => {
        //prepare sensor services
        if (this.sensorPower) {
            this.debugLog(`Prepare power sensor service`);
            this.sensorPowerService = this.createContactSensor('Power', () => this.power);
            this.addService(this.sensorPowerService);
        };

        if (this.sensorVolume) {
            this.debugLog(`Prepare volume sensor service`);
            this.sensorVolumeService = this.createContactSensor('Volume', () => this.sensorVolumeState);
            this.addService(this.sensorVolumeService);
        };

        if (this.sensorMute) {
            this.debugLog(`Prepare mute sensor service`);
            this.sensorMuteService = this.createContactSensor('Mute', () => this.power ? this.muted : false);
            this.addService(this.sensorMuteService);
        };

        if (this.sensorInput) {
            this.debugLog(`Prepare input sensor service`);
            this.sensorInputService = this.createContactSensor('Input', () => this.sensorInputState);
            this.addService(this.sensorInputService);
        };
    }

    prepareButtonServices = () => {
        //prepare buttons services
        const possibleButtonsCount = 99 - this.allServices.length;
        const maxButtonsCount = this.buttonsConfiguredCount >= possibleButtonsCount ? possibleButtonsCount : this.buttonsConfiguredCount;
        if (maxButtonsCount > 0) {
            this.buttonsServices = [];
            this.debugLog(`Prepare buttons services`);
            for (let i = 0; i < maxButtonsCount; i++) {
                //get button
                const button = this.buttonsConfigured[i];

                //get button name
                const buttonName = button.name;

                //get button reference
                const buttonReference = button.reference;

                //get button name prefix
                const namePrefix = button.namePrefix || false;

                //get service type
                const serviceType = button.serviceType;

                const serviceName = namePrefix ? `${this.Name} ${buttonName}` : buttonName;
                const buttonService = new serviceType(serviceName, `Button ${i}`);
                buttonService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                buttonService.setCharacteristic(Characteristic.ConfiguredName, serviceName);  
                buttonService.getCharacteristic(Characteristic.On)
                    .onSet(async (state) => {
                        try {
                            const directSound = CONSTANTS.DirectSoundMode[buttonReference] ?? false;
                            const directSoundModeMode = directSound ? directSound.mode : false;
                            const directSoundModeSurround = directSound ? directSound.surround : false;
                            const command = directSound ? directSoundModeMode : buttonReference.substring(1);
                            const reference = command;

                            const set = state ? await this.denon.send(reference) : false;
                            const set2 = state && directSound ? await this.denon.send(directSoundModeSurround) : false;
                            this.infoLog(`set Button Name: ${buttonName}, Reference: ${reference}`);
                        } catch (error) {
                            this.warnLog(`set Button error: ${error}`);
                        };
                    });

                this.buttonsServices.push(buttonService);
                this.addService(accessory, buttonService);
            };
        };
        
    }

    createContactSensor = (sensorType, sensorStateFn) => {
        if (!SENSOR_TYPES.includes(sensorType)) 
        {
            this.warnLog(`Sensor Type: ${sensorType}, invalid for trigger!`);
            return;
        }
        if (!sensorStateFn) {
          this.debugLog(`Sensor Type: ${sensorType}, missing function for trigger!`);
          return;
        }
        const serviceName = `${this.name} ${sensorType} Sensor`;
        const sensorService = new Service.ContactSensor(sensorName, `${sensorType.toLowerCase()}Sensor`);
        sensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
        sensorService.setCharacteristic(Characteristic.ConfiguredName, serviceName);  
        sensorService.getCharacteristic(Characteristic.ContactSensorState)
            .onGet(async () => {
                const state = sensorStateFn() ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
                return state;
            });
        return sensorService;
    }

    createStatelessSwitchService = (name, id, setterFn) => {
        let newStatelessSwitchService = new Service.Switch(name, id);
        newStatelessSwitchService
          .getCharacteristic(Characteristic.On)
          .onGet(this.getStatelessSwitchState)
          .onSet((state) => {
            setterFn(state);
          });
        newStatelessSwitchService.addOptionalCharacteristic(Characteristic.ConfiguredName);
        newStatelessSwitchService.setCharacteristic(Characteristic.ConfiguredName, name);  
        return newStatelessSwitchService;
    }
    
    addService = (service) => {
        this.allServices.push(service);
        this.accessory.addService(service);
    }

    getStatelessSwitchState = () => {
        return false;
    }

    setMute = async (state) => {
        if (this.muted) 
          await this.zone.zoneUnmute();
        else
          await this.zone.zoneMute();
    
        this.resetStatelessButtons();
    }

    setVolumeUp = async (state) => {
        const volume = this.volume;
        if (this.power && volume < MAX_VOLUME)
            await this.zone.volumeUp();
        this.resetVolumeControlButtons();
    }

    setVolumeDown = async (state) => {
        const volume = this.volume;
        if (this.power && volume > 0)
            await this.zone.volumeDown();
    
        this.resetVolumeControlButtons();
    }

    resetVolumeControlButtons = () => {
        setTimeout(() => {
                if (this.volumeDownService) this.volumeDownService.updateCharacteristic(Characteristic.On, false);
                if (this.volumeUpService) this.volumeUpService.updateCharacteristic(Characteristic.On, false);
            }, BUTTON_RESET_TIMEOUT);
    }

    debugLog = (msg) => {
		if (this.enableDebugMode) this.emit('debug', msg);
	}

    infoLog = (msg) => {
		if (!this.disableLogInfo) this.emit('message', msg);
	}

    warnLog = (msg) => {
		this.emit('warn', msg);
	}

    log = (msg) => {
        this.emit('message', msg);
    }

    devInfoLog = (msg) => {
        this.emit('devInfo', msg);
    }

};

module.exports = Zone;
