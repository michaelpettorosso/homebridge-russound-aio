'use strict';
const fs = require('fs');
const fsPromises = fs.promises;
const EventEmitter = require('events');
const CONSTANTS = require('./constants.json');
let Accessory, Characteristic, Service, Categories, Encode, AccessoryUUID;

const BUTTON_RESET_TIMEOUT = 20; // in milliseconds
const MAX_VOLUME = 50; 

class Zone extends EventEmitter {
    constructor(api, config, controller, zoneId, devInfoFile, inputsFile, inputsNamesFile, inputsTargetVisibilityFile) {
        super();

        Accessory = api.platformAccessory;
        Characteristic = api.hap.Characteristic;
        Service = api.hap.Service;
        Categories = api.hap.Categories;
        Encode = api.hap.encode;
        AccessoryUUID = api.hap.uuid;

        //device configuration
        this.controller = controller;
        this.zoneId = zoneId;
        this.zone = this.getZone();
        this.name = (this.zone.name?.replace('/',' ') ?? `Zone ${zoneId}`) + (config?.zoneNameSuffix ?  ` ${config.zoneNameSuffix}` : '');

        this.addRemote = (config?.zones ? config.zones[zoneId]?.addRemote : config?.addRemote) ?? false;

        //logging flags
        this.enableDebugMode = config?.enableDebugMode || false;
        this.disableLogInfo = config?.disableLogInfo || false;
        this.disableLogDeviceInfo = config?.disableLogDeviceInfo || false;

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
        this.devInfoFile = devInfoFile;
        this.inputsFile = inputsFile;
        this.inputsNamesFile = inputsNamesFile;
        this.inputsTargetVisibilityFile = inputsTargetVisibilityFile;

        //services
        this.allServices = [];

        //input settings
        this.inputs = config?.zones ? config.zones[zoneId]?.sources : null ?? [];
        this.inputsDisplayOrder = config?.inputsDisplayOrder || 0;
        this.getInputsFromDevice = config?.getInputsFromDevice || false;
        this.inputsConfigured = [];
        this.inputIdentifier = 1;

        //buttons settings
        this.buttons = config.buttons || [];
        this.buttonsConfigured = [];
        for (const button of this.buttons) {
            const buttonName = button.name ?? false;
            const buttonReference = button.reference ?? false;
            const buttonDisplayType = button.displayType ?? 0;
            if (buttonName && buttonReference && buttonDisplayType > 0) {
                button.serviceType = ['', Service.Outlet, Service.Switch][buttonDisplayType];
                button.state = false;
                this.buttonsConfigured.push(button);
            } else {
                const log = buttonDisplayType === 0 ? false : this.log(`Button Name: ${buttonName ? buttonName : 'Missing'}, Reference: ${buttonReference ? buttonReference : 'Missing'}.`);
            };
        }
        this.buttonsConfiguredCount = this.buttonsConfigured.length || 0;

        //state variables
        this.startPrepareAccessory = true;

        this.power = false;
        this.volume = 0;
        this.muted = true;
        this.mediaState = false;


    };

    getZone = () => {
        const zone = this.controller.zones[this.zoneId];
        this.debugLog(`getZone: ${zone}`);
        return zone;
    }

    onStateChange = async (zone, sources) => {
        try {
            this.debugLog(`onStateChange: ${JSON.stringify(zone, null, 2)}`);
                // name: 'Pool',
                // volume: '10',
                // bass: '0',
                // treble: '0',
                // balance: '0',
                // loudness: 'OFF',
                // turnOnVolume: '10',
                // doNotDisturb: 'OFF',
                // partyMode: 'OFF',
                // status: 'OFF',
                // mute: 'OFF',
                // sharedSource: 'OFF',
                // lastError: '',
                // page: 'OFF',
                // sleepTimeDefault: '15',
                // sleepTimeRemaining: '0',
                // enabled: 'False',
                // currentSource: '4'


            const { status, volume, mute, currentSource } = zone;
            const power = status === 'ON';
            const mutedState = power ? mute === 'ON' : true;
            const powerState = power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;

            const input = this.inputsConfigured.find(input => input.identifier == parseInt(currentSource,10)) ?? false;
            const inputIdentifier = input ? input.identifier : this.inputIdentifier;
            if (this.televisionService) {
                const pictureModeHomeKit = Characteristic.PictureMode.OTHER;
                this.televisionService
                    .updateCharacteristic(Characteristic.Active, powerState)
                    .updateCharacteristic(Characteristic.ActiveIdentifier, inputIdentifier)
                    .updateCharacteristic(Characteristic.PictureMode, pictureModeHomeKit);

                //this.televisionService.getCharacteristic(Characteristic.Active).updateValue(powerState)    
                this.debugLog(`mutedState: ${mutedState}, powerState: ${powerState}`);

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
                const state = power ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;

                this.sensorPowerService
                    .updateCharacteristic(Characteristic.ContactSensorState, state)
            }

            if (volume !== this.volume) {
                for (let i = 0; i < 2; i++) {
                    const state = power ? [true, false][i] : false;
                    if (this.sensorVolumeService) {
                        this.sensorVolumeService
                            .updateCharacteristic(Characteristic.ContactSensorState, state ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
                        this.sensorVolumeState = state;
                    }
                }
            }

            if (this.sensorMuteService) {
                const state = power && mute === 'ON' ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
                this.sensorMuteService
                    .updateCharacteristic(Characteristic.ContactSensorState, state)
            }

            if (inputIdentifier !== this.inputIdentifier) {
                for (let i = 0; i < 2; i++) {
                    const state = power ? [true, false][i] : false;
                    if (this.sensorInputService) {
                        this.sensorInputService
                            .updateCharacteristic(Characteristic.ContactSensorState, state ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
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
            this.mute = mutedState;
    
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

    start = async(sources) => {
        try {
            this.manufacturer = this.controller?.manufacturer || 'Russound';
            this.modelName = `${this.controller.controllerType}-Zone-${this.zoneId}`;
            this.serialNumber = `0000-0000-${this.zone.deviceStr.replace(/[\[\].']+/g,'')}`;
            this.firmwareRevision = this.controller.firmwareVersion;

            const saveInputs = await this.saveData(this.inputsFile, sources);

            if (this.enableDebugMode)
            {
                this.devInfoLog(`Logging: enableDebugMode: ${this.enableDebugMode}`);
                this.devInfoLog(`Logging: disableLogInfo: ${this.disableLogInfo}`);
                this.devInfoLog(`Logging: disableLogDeviceInfo: ${this.disableLogDeviceInfo}`);

                this.devInfoLog(`Sensor: sensorPower: ${this.sensorPower}`);
                this.devInfoLog(`Sensor: sensorVolume: ${this.sensorVolume}`);
                this.devInfoLog(`Sensor: sensorMute: ${this.sensorMute}`);
                this.devInfoLog(`Sensor: sensorInput: ${this.sensorInput}`);

                this.devInfoLog(`Volume: volumeControlNamePrefix: ${this.volumeControlNamePrefix}`);
                this.devInfoLog(`Volume: volumeControlName: ${this.volumeControlName}`);
                this.devInfoLog(`Volume: volumeControl: ${this.volumeControl}`);
                this.devInfoLog(`Volume: volumeMax: ${this.volumeMax}`);

                this.devInfoLog(`File: devInfoFile: ${this.devInfoFile}`);
                this.devInfoLog(`File: inputsFile: ${this.inputsFile}`);
                this.devInfoLog(`File: inputsNamesFile: ${this.inputsNamesFile}`);
                this.devInfoLog(`File: inputsTargetVisibilityFile: ${this.inputsTargetVisibilityFile}`);
            }
        
            if (!this.disableLogInfo)
            {
                this.devInfoLog(`Power: ${this.power}`);
                this.devInfoLog(`Volume: ${this.volume}`);
                this.devInfoLog(`Muted: ${this.muted}`);
                this.devInfoLog(`Media State: ${this.mediaState}`);
            }

            if (!this.disableLogDeviceInfo) {
                this.devInfoLog(`-------- ${this.name} --------`);
                this.devInfoLog(`Manufacturer: ${this.manufacturer}`);
                this.devInfoLog(`Model: ${this.modelName}`);
                this.devInfoLog(`Control: Zone ${this.zone?.name ?? this.zoneId}`);
                this.devInfoLog(`ZoneId: ${this.zoneId}`);
                this.devInfoLog(`Firmware: ${this.firmwareRevision}`);
                this.devInfoLog(`Api version: ${this.controller.client.rioVersion}`);
                this.devInfoLog(`SerialNumber: ${this.serialNumber}`);
                this.devInfoLog(`----------------------------------`);
            }

            const saveDevInfo = await this.saveData(this.devInfoFile, { 
                name: this.name,
                manufacturer: this.manufacturer,
                modelName: this.modelName,
                control: `Zone ${this.zone?.name ?? this.zoneId}`,
                zoneId: this.zoneId,
                firmware: this.firmwareRevision,
                apiVersion: this.controller.client.rioVersion,
                serialNumber: this.serialNumber
             });

            if (this.startPrepareAccessory)
            {
                this.startPrepareAccessory = false;
                //read inputs names from file
                const savedInputsNames = await this.readData(this.inputsNamesFile);
                this.savedInputsNames = savedInputsNames.toString().trim() !== '' ? JSON.parse(savedInputsNames) : {};
                this.debugLog(`Read saved Inputs Names: ${JSON.stringify(this.savedInputsNames, null, 2)}`);
    
                //read inputs visibility from file
                const savedInputsTargetVisibility = await this.readData(this.inputsTargetVisibilityFile);
                this.savedInputsTargetVisibility = savedInputsTargetVisibility.toString().trim() !== '' ? JSON.parse(savedInputsTargetVisibility) : {};
                this.debugLog(`Read saved Inputs Target Visibility: ${JSON.stringify(this.savedInputsTargetVisibility, null, 2)}`);
    
                
                //prepare accessory
                const accessory = await this.prepareAccessory(sources);
                const sortInputsDisplayOrder = this.televisionService ? await this.displayOrder() : false;
                this.emit('publishAccessory', accessory);
            }    
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
            this.debugLog(`Inputs display order: ${JSON.stringify(this.inputsConfigured, null, 2)}`);

            const displayOrder = this.inputsConfigured.map(input => input.identifier);
            this.televisionService.setCharacteristic(Characteristic.DisplayOrder, Encode(1, displayOrder).toString('base64'));
            return true;
        } catch (error) {
            throw new Error(`Display order error: ${error.message || error}`);
        };
    }

    async saveData(path, data) {
        try {
            data = JSON.stringify(data, null, 2);
            await fsPromises.writeFile(path, data);
            this.debugLog(`Saved data: ${data}`);
            return true;
        } catch (error) {
            throw new Error(`Save data error: ${error.message || error}`);
        };
    }

    async readData(path) {
        try {
            const data = await fsPromises.readFile(path);
            return data;
        } catch (error) {
            throw new Error(`Read data error: ${error.message || error}`);
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
    prepareAccessory = async (allSources) => {
        try {
            
            //accessory
            this.debugLog(`Prepare accessory`);
            const accessoryName = this.name;
            const accessoryUUID = AccessoryUUID.generate(this.serialNumber);
            const accessoryCategory = Categories.AUDIO_RECEIVER;
            const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

            //information service
            this.debugLog(`Prepare information service`);
            this.informationService = accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
                .setCharacteristic(Characteristic.Model, this.modelName)
                .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)
                .setCharacteristic(Characteristic.FirmwareRevision, this.firmwareRevision);


            this.informationService.addOptionalCharacteristic(Characteristic.ConfiguredName);
            this.informationService.setCharacteristic(Characteristic.ConfiguredName, accessoryName);
            this.informationService.addOptionalCharacteristic(Characteristic.HardwareRevision);
            this.informationService.setCharacteristic(Characteristic.HardwareRevision, this.controller.macAddress);
            this.informationService.addOptionalCharacteristic(Characteristic.SoftwareRevision);
            this.informationService.setCharacteristic(Characteristic.SoftwareRevision, this.controller.client.rioVersion);

            this.allServices.push(this.informationService);

           
            //prepare television service
            this.debugLog(`Prepare television service`);
            this.televisionService = accessory.addService(Service.Television, `${accessoryName} Television`, 'Television');
            this.televisionService.addOptionalCharacteristic(Characteristic.ConfiguredName);
            this.televisionService.setCharacteristic(Characteristic.ConfiguredName, accessoryName);
            this.televisionService.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

            this.televisionService.getCharacteristic(Characteristic.Active)
                // .onGet(() => {
                //     const state = this.power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
                //     return state;
                // })
                .onSet(async (state) => {
                    if (this.power == state) {
                        return;
                    }

                    try {
                        if (state)
                          await this.zone.zoneOn();
                        else
                          await this.zone.zoneOff();

                        this.infoLog(`set Power: ${state ? 'ON' : 'OFF'}`);
                    } catch (error) {
                        this.warnLog(`set Power error: ${error}`);
                    };
                });

            this.televisionService.getCharacteristic(Characteristic.ActiveIdentifier)
                // .onGet(async () => {
                //     const inputIdentifier = this.inputIdentifier;
                //     return inputIdentifier;
                // })

                .onSet(async (activeIdentifier) => {
                    try {
                        const input = this.inputsConfigured.find(input => input.identifier === activeIdentifier);
                        const inputName = input.name;

                        switch (this.power) {
                            case false:
                                await new Promise(resolve => setTimeout(resolve, 4000));
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


            this.allServices.push(this.televisionService);

            //prepare speaker service
            this.debugLog(`Prepare speaker service`);
            this.speakerService = accessory.addService(Service.TelevisionSpeaker, `${accessoryName} Speaker`, 'Speaker');
            this.speakerService.getCharacteristic(Characteristic.Active)
                // .onGet(async () => {
                //     const state = this.power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
                //     return state;
                // })
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
                // .onGet(async () => {
                //     const volume = this.getScaledVolume(this.volume);
                //     return volume;
                // })
                .onSet(async (value) => {
                    try {
                        await this.zone.setVolume(this.getSetVolume(value));
                        this.infoLog(`set Volume: ${value}`);
                    } catch (error) {
                        this.warnLog(`set Volume error: ${error}`);
                    };
                });

            this.speakerService.getCharacteristic(Characteristic.Mute)
                // .onGet(async () => {
                //     const state = this.muted;
                //     return state;
                // })
                .onSet(async (state) => {
                    try {
                        if (state)
                          await this.zone.zoneMute();
                        else
                          await this.zone.zoneUnmute();
                        this.muted = state;
                        const info = this.logInfo(`set Mute: ${state ? 'ON' : 'OFF'}`);
                    } catch (error) {
                        this.warnLog(`set Mute error: ${error}`);
                    };
                });

            this.allServices.push(this.speakerService);



            //prepare inputs service
            this.debugLog(`Prepare inputs services`);

            // name: 'Source 6',
            // type: '',
            // channel: null,
            // coverArtURL: null,
            // channelName: null,
            // genre: null,
            // artistName: null,
            // albumName: null,
            // playlistName: null,
            // songName: null,
            // programServiceName: null,
            // radioText: null,
            // shuffleMode: null,
            // repeatMode: null,
            // mode: null,
            // playStatus: null,
            // sampleRate: null,
            // bitRate: null,
            // bitDepth: null,
            // playTime: null,
            // trackTime: null,

            const sources = []
            for (const source of allSources) {
                if (this.inputs.length === 0 || (this.inputs.includes(source.name)))  
                    sources.push(source)
            }

            this.debugLog(`Zone ${this.zoneId} Sources ${JSON.stringify(sources, null, 2)} All Sources ${JSON.stringify(allSources, null, 2)}`);

            //check possible inputs count (max 85)
            const inputs = sources ?? allSources;
            const inputsCount = inputs.length;
            const possibleInputsCount = 85 - this.allServices.length;
            const maxInputsCount = inputsCount >= possibleInputsCount ? possibleInputsCount : inputsCount;
            for (let i = 0; i < maxInputsCount; i++) {
                //input
                const input = inputs[i];

                //get input reference
                const inputIdentifier = input.identifier;

                //get input name
                const savedInputsName = this.savedInputsNames[inputIdentifier] ?? false;
                input.name = savedInputsName ? savedInputsName : input.name;

                //get type
                const inputSourceType = Characteristic.InputSourceType.OTHER;

                //get configured
                const isConfigured = Characteristic.IsConfigured.CONFIGURED;

                //get visibility
                input.visibility = this.savedInputsTargetVisibility[inputIdentifier] ?? Characteristic.CurrentVisibilityState.SHOWN;

                //input service
                const inputService = accessory.addService(Service.InputSource, input.name, `Input ${inputIdentifier}`);
                inputService
                    .setCharacteristic(Characteristic.Identifier, inputIdentifier)
                    .setCharacteristic(Characteristic.Name, input.name)
                    .setCharacteristic(Characteristic.IsConfigured, isConfigured)
                    .setCharacteristic(Characteristic.InputSourceType, inputSourceType)
                    .setCharacteristic(Characteristic.CurrentVisibilityState, input.visibility)

                inputService.getCharacteristic(Characteristic.ConfiguredName)
                    .onGet(async () => {
                        return input.name;
                    })
                    .onSet(async (value) => {
                        if (value == this.savedInputsNames[inputIdentifier]) {
                            return;
                        }

                        try {
                            input.name = value;
                            this.savedInputsNames[inputIdentifier] = value;
                            await this.saveData(this.inputsNamesFile, this.savedInputsNames);
                            this.debugLog(`Saved Input Name: ${value}, Input Identifier: ${inputIdentifier}`);

                            //sort inputs
                            const index = this.inputsConfigured.findIndex(input => input.inputIdentifier === inputIdentifier);
                            this.inputsConfigured[index].name = value;
                            await this.displayOrder();
                        } catch (error) {
                            this.warnLog(`save Input Name error: ${error}`);
                        }
                    });

                inputService.getCharacteristic(Characteristic.TargetVisibilityState)
                    .onGet(async () => {
                        return input.visibility;
                    })
                    .onSet(async (state) => {
                        if (state === this.savedInputsTargetVisibility[inputIdentifier]) {
                            return;
                        }

                        try {
                            input.visibility = state;
                            this.savedInputsTargetVisibility[inputIdentifier] = state;
                            await this.saveData(this.inputsTargetVisibilityFile, this.savedInputsTargetVisibility);
                            this.debugLog(`Saved Input: ${input.name} Target Visibility: ${state ? 'HIDEN' : 'SHOWN'}`);
                        } catch (error) {
                            this.warnLog(`save Input Target Visibility error: ${error}`);
                        }
                    });

                this.inputsConfigured.push(input);
                this.televisionService.addLinkedService(inputService);
                this.allServices.push(inputService);
            };

            //prepare volume service
            if (this.volumeControl) {
                this.debugLog(`Prepare volume service`);
                const volumeServiceName = this.volumeControlNamePrefix ? `${accessoryName} ${this.volumeControlName}` : this.volumeControlName;
                if (this.volumeControl === 1) {
                    this.volumeService = accessory.addService(Service.Lightbulb, `${volumeServiceName}`, 'Volume');
                    this.volumeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    this.volumeService.setCharacteristic(Characteristic.ConfiguredName, `${volumeServiceName}`);
                    this.volumeService.getCharacteristic(Characteristic.Brightness)
                        .setProps({
                            minValue: 0,
                            maxValue: this.getVolumeMax()
                        })
                        // .onGet(async () => {
                        //     const volume = this.getScaledVolume(this.volume);
                        //     return volume;
                        // })
                        .onSet(async (volume) => {
                            this.speakerService.setCharacteristic(Characteristic.Volume, volume);
                        });
                    this.volumeService.getCharacteristic(Characteristic.On)
                        // .onGet(async () => {
                        //     const state = !this.muted;
                        //     return state;
                        // })
                        .onSet(async (state) => {
                            this.speakerService.setCharacteristic(Characteristic.Mute, !state);
                        });

                    this.allServices.push(this.volumeService);
                }

                if (this.volumeControl === 2) {
                    this.volumeServiceFan = accessory.addService(Service.Fan, `${volumeServiceName}`, 'Volume');
                    this.volumeServiceFan.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    this.volumeServiceFan.setCharacteristic(Characteristic.ConfiguredName, `${volumeServiceName}`);
                    this.volumeServiceFan.getCharacteristic(Characteristic.RotationSpeed)
                        .setProps({
                            minValue: 0,
                            maxValue: this.getVolumeMax()
                        })
                        // .onGet(async () => {
                        //     const volume = this.getScaledVolume(this.volume);
                        //     return volume;
                        // })
                        .onSet(async (volume) => {
                            this.speakerService.setCharacteristic(Characteristic.Volume, volume);
                        });
                    this.volumeServiceFan.getCharacteristic(Characteristic.On)
                        // .onGet(async () => {
                        //     const state = !this.muted;
                        //     return state;
                        // })
                        .onSet(async (state) => {
                            this.speakerService.setCharacteristic(Characteristic.Mute, !state);
                        });

                    this.allServices.push(this.volumeServiceFan);
                }
            };

            //prepare sensor service
            if (this.sensorPower) {
                this.debugLog(`Prepare power sensor service`);
                this.sensorPowerService = accessory.addService(Service.ContactSensor, `${this.name} Power Sensor`, `Power Sensor`);
                this.sensorPowerService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.sensorPowerService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Power Sensor`);
                this.sensorPowerService.getCharacteristic(Characteristic.ContactSensorState)
                    .onGet(async () => {
                        const state = this.power ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
                        return state;
                    });

                this.allServices.push(this.sensorPowerService);
            };

            if (this.sensorVolume) {
                this.debugLog(`Prepare volume sensor service`);
                this.sensorVolumeService = accessory.addService(Service.ContactSensor, `${this.name} Volume Sensor`, `Volume Sensor`);
                this.sensorVolumeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.sensorVolumeService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Volume Sensor`);
                this.sensorVolumeService.getCharacteristic(Characteristic.ContactSensorState)
                    .onGet(async () => {
                        const state = this.sensorVolumeState ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
                        return state;
                    });

                this.allServices.push(this.sensorVolumeService);
            };

            if (this.sensorMute) {
                this.debugLog(`Prepare mute sensor service`);
                this.sensorMuteService = accessory.addService(Service.ContactSensor, `${this.sZoneName} Mute Sensor`, `Mute Sensor`);
                this.sensorMuteService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.sensorMuteService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Mute Sensor`);
                this.sensorMuteService.getCharacteristic(Characteristic.ContactSensorState)
                    .onGet(async () => {
                        const state = this.power ? this.muted : false ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
                        return state;
                    });

                this.allServices.push(this.sensorMuteService);
            };

            if (this.sensorInput) {
                this.debugLog(`Prepare input sensor service`);
                this.sensorInputService = accessory.addService(Service.ContactSensor, `${this.sZoneName} Input Sensor`, `Input Sensor`);
                this.sensorInputService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.sensorInputService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Input Sensor`);
                this.sensorInputService.getCharacteristic(Characteristic.ContactSensorState)
                    .onGet(async () => {
                        const state = this.sensorInputState ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
                        return state;
                    });

                this.allServices.push(this.sensorInputService);
            };

            this.debugLog(`Prepare Stateless Switch services`);
            this.volumeUpService = this.createStatelessSwitchService('Volume Up', 'volumeUpService', this.setVolumeUp);
            this.addService(accessory, this.volumeUpService);

            this.volumeDownService = this.createStatelessSwitchService('Volume Down', 'volumeDownService', this.setVolumeDown);
            this.addService(accessory, this.volumeDownService);

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

                    const serviceName = namePrefix ? `${accessoryName} ${buttonName}` : buttonName;
                    const buttonService = new serviceType(serviceName, `Button ${i}`);
                    buttonService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    buttonService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    buttonService.getCharacteristic(Characteristic.On)
                        // .onGet(async () => {
                        //     const state = button.state;
                        //     return state;
                        // })
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

            return accessory;
        } catch (error) {
            throw new Error(error)
        };
    }

    createStatelessSwitchService = (name, id, setterFn) => {
        let newStatelessSwitchService = new Service.Switch(name, id);
        newStatelessSwitchService
          .getCharacteristic(Characteristic.On)
          .onGet(this.getStatelessSwitchState)
          .onSet((state) => {
                setterFn(state);
          });
    
        this.setServiceConfiguredName(newStatelessSwitchService, name);
        return newStatelessSwitchService;
    }
    
    addService = (accessory, service) => {
        this.allServices.push(service);
        accessory.addService(service);
    }

    getStatelessSwitchState = () => {
        return false;
    }

    setServiceConfiguredName = (service, name) => {
        if (service) {
            service.addOptionalCharacteristic(Characteristic.ConfiguredName);
            service.setCharacteristic(Characteristic.ConfiguredName, name);
        }
    }

    setMute = async (state) => {
        if (this.power)
            if (!this.muted) 
                await this.zone.zoneMute();
            else
                await this.zone.zoneUnmute();
    
        this.resetStatelessButtons();
    }

    setVolumeUp = async (state) => {
        if (this.power && this.volume < MAX_VOLUME)
            await this.zone.volumeUp();
    
        this.resetStatelessButtons();
    }

    setVolumeDown = async (state) => {
        if (this.power && this.volume > 0)
            await this.zone.volumeDown();
    
        this.resetStatelessButtons();
    }

    resetStatelessButtons = () => {
        setTimeout(() => {
                if (this.volumeDownService) this.volumeDownService.getCharacteristic(Characteristic.On).updateValue(false);
                if (this.volumeUpService) this.volumeUpService.getCharacteristic(Characteristic.On).updateValue(false);
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
