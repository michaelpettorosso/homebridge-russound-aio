# homebridge-russound-aio

`homebridge-russound-aio` is a plugin for Homebridge intended to give you an integrated experience with your [Russound](https://russound.com) devices.

Creates zones as external devices, and creates Remotes for each zone to use 

It provides the HomeKit Zone Accesories with services which include a 

  power
  input
  volume
  mute 
  volume dimmer (as light slider).
  **remote functions**
-       Next
-       Previous
-       MenuUp
-       MenuDown
-       MenuLeft
-       MenuRight
-       Enter
-       Exit
-       Play
-       Pause
-       Stop
-       Info

![Screenshot](zones.jpg) ![Screenshot](accessories.jpg) ![Screenshot](remote.jpg)

# Changelog
* Initial Release.

# To Do

Only supports one controller at the moment


## Requirements and Limitations

## Installation

If you are new to Homebridge, please first read the Homebridge [documentation](https://www.npmjs.com/package/homebridge).

1. Install Homebridge:
```sh
sudo npm install -g --unsafe-perm homebridge
```

2. Install homebridge-russound-aio:
```sh
sudo npm install -g --unsafe-perm homebridge-russound-aio
```

## Plugin configuration
Add the platform in `config.json` in your home directory inside `.homebridge` and edit the required fields.

```js
{
   "platforms":[
      {
         "name":"Russound AIO",
         "host":"your.russound.ip",
         "port": 9621,
         "enableDebugMode": true,
         "platform": "Russound-AIO",
         "zones": [
                { 
                 "id": "1",
                 "enabled": true,
                 "sources": [
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                    ]
                },
                { 
                 "id": "2",
                 "enabled": true,
                 "sources": [
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                    ]
                },
                { 
                 "id": "3",
                 "enabled": true,
                 "sources": [
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                    ]
                },
                { 
                 "id": "4",
                 "enabled": true,
                 "sources": [
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                    ]
                },
                { 
                 "id": "5",
                 "enabled": true,
                 "sources": [
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                    ]
                },
                { 
                 "id": "6",
                 "enabled": true,
                 "sources": [
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                    ]
                }
            ]
      }
   ]
}
```

### Config Explanation:

The id for Zone1, Zone2, Zone3, Zone4, Zone5 and Zone6 should match the Zone id given in the Russound Controller configuration (the order in the Russound App)

The names Source1, Source2, Source3, Source4, Source5 and Source6 should match the Source names given in the Russound Controller configuration (the names in the Russound App)
  
  Any non configured sources identified as 'N/A' will be ignored

With this configuration you can define which sources are attached to which zones, the Russound API doesn't identify the configuration correctly.
That is, if different sources are selected for different zones in the Russound Controller configuration there is no way to determine this through the API. 
The Russound App doesn't handle this, I've added the capability to manage 

###

After restarting Homebridge, the Russound will need to be manually paired in the Home app, to do this:

1. Open the Home <img src="https://user-images.githubusercontent.com/3979615/78010622-4ea1d380-738e-11ea-8a17-e6a465eeec35.png" height="16.42px"> app on your device.
2. Tap the Home tab, then tap <img src="https://user-images.githubusercontent.com/3979615/78010869-9aed1380-738e-11ea-9644-9f46b3633026.png" height="16.42px">.
3. Tap *Add Accessory*, and select *I Don't Have a Code or Cannot Scan*.
4. Select the Configured Zones for pairing.
5. Enter the Homebridge PIN, this can be found under the QR code in Homebridge UI or your Homebridge logs, alternatively you can select *Use Russound* and scan the QR code again.

### Feature Options
Feature options allow you to enable or disable certain features in this plugin. There are plugin-wide feature options, and some that are specific to individual Controllers.


Platform-level configuration parameters:

| Fields                  | Description                                                        | Default                                                                   | Required |
|-------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------|----------|
| platform                | Must always be `Russound-AIO`                                      |                                                                           | Yes      |
| host                    | Host IP address of your Russound Controller                        |                                                                           | Yes      |
| port                    | API Port of your Russound Controller                               | 9621                                                                      | No       |
| name                    | Name to use for this Russound Controller.                          | [controller type] eg. MCA-66                                              | No       |
| zoneNameSuffix          | Suffix to add to Zone Name eg. Speaker                             |                                                                           | No       |
| addRemote               | Add Apple remote to all Zones                                      | false                                                                     | No       |
| inputsDisplayOrder      | Display order for inputs in Homekit                                | 0 [0 - Russound, 1 - Name Asc, 2 - Name Desc]                             | No       |
| volumeControl           | Add volume accessory                                               | 1 [0 - None, 1 - As Light (Brightness), 2 - As Fan]                       | No       |
| volumeControlName       | Added volume name                                                  | Volume                                                                    | No       |
| volumeControlNamePrefix | Add Zone name as prefix to volume name                             | false                                                                     | No       |
| volumeMax               | Max volume of Zones                                                | 50 [MCA Device tested]                                                    | No       |
| sensorPower             | Add Sensor Power (for change)                                      | false                                                                     | No       |
| sensorVolume            | Add Sensor Volume (for change)                                     | false                                                                     | No       |
| sensorMute              | Add Sensor Mute (for change)                                       | false                                                                     | No       |
| sensorInput             | Add Sensor Input (for change)                                      | false                                                                     | No       |
| zones                   | List of Zones to configure                                         | {}                                                                        | No       |


`logging` parameters:

| Fields                  | Description                                                        | Default                                                                   | Required |
|-------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------|----------|
| enableDebugMode         | Enable debug logging in Homebridge                                 | false                                                                     | No       |
| disableLogInfo          | Disable state log info in Homebridge                               | false                                                                     | No       |
| disableLogDeviceInfo    | Disable device log info in Homebridge                              | false                                                                     | No       |


`zones` Zones settings:

| Fields                  | Description                                                        | Default                                                                   | Required |
|-------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------|----------|
| zoneId                  | Id of this zone configured on the Russound Controller.             |                                                                           | Yes      |
| enabled                 | Hides zone from Homekit                                            | true                                                                      | No       |
| addRemote               | Add Apple remote for Zone                                          | false                                                                     | No       |
| sources                 | List of sources to add to Zone                                     |                                                                           | No       |

`sources` sources settings:

| Fields                  | Description                                                        | Default                                                                   | Required |
|-------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------|----------|
| _                       | Name to of this source configured on the Russound Controller        |                                                                           | No       |


## Credits
