# homebridge-russound-aio

`homebridge-russound-aio` is a plugin for Homebridge intended to give you an integrated experience with your [Russound](https://russound.com) devices.

Now creates zones as external devices, and creates Remotes for each zone to use 

It provides the HomeKit Zone Accesories with services which include a 

  power
  input
  volume
  mute 
  volume dimmer (as light slider).
  remote functions
      Next
      Previous
      MenuUp
      MenuDown
      MenuLeft
      MenuRight
      Enter
      Exit
      Play
      Pause
      Stop
      Info

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
         "name":"Russound",
         "controllers":[
            {
               "name":"MCA XXX",
               "ip":"your.russound.ip",
               "zones":[
                  {
                     "name":"Zone1",
                     "display_name":"Zone 1",
                     "sources":[
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                     ]
                  },
                  {
                     "name":"Zone2",
                     "display_name":"Zone 2",
                     "sources":[
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                     ]
                  },
                  {
                     "name":"Zone3",
                     "display_name":"Zone 3",
                     "sources":[
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                     ],
                     "enable":false
                  },
                  {
                     "name":"Zone4",
                     "display_name":"Zone 4",
                     "sources":[
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                     ]
                  },
                  {
                     "name":"Zone5",
                     "display_name":"Zone 5",
                     "sources":[
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                     ]
                  },
                  {
                     "name":"Zone6",
                     "display_name":"Zone 6",
                     "sources":[
                        "Source1",
                        "Source2",
                        "Source3",
                        "Source4",
                        "Source5",
                        "Source6"
                     ]
                  }
               ],
               "sources":[
                  {
                     "name":"Source1",
                     "display_name":"Source 1"
                  },
                  {
                     "name":"Source2",
                     "display_name":"Source 2"
                  },
                  {
                     "name":"Source3",
                     "display_name":"Source 3"
                  },
                  {
                     "name":"Source4",
                     "display_name":"Source 4"
                  },
                  {
                     "name":"Source5",
                     "display_name":"Source 5"
                  },
                  {
                     "name":"Source6",
                     "display_name":"Source 6"
                  }
               ]
            }
         ],
         "debug":false,
         "platform":"Russound-AIO"
      }
   ]
}
```

### Config Explanation:

The names Zone1, Zone2, Zone3, Zone4, Zone5 and Zone6 should match the Zone names given in the Russound Controller configuration (the names in the Russound App)

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

| Fields                 | Description                                                        | Default                                                                   | Required |
|------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------|----------|
| platform               | Must always be `Russound`.                                         |                                                                           | Yes      |
| name                   | Name to use for the Russound platform.                             |                                                                           | No       |
| debug                  | Enable debug logging.                                              | false                                                                     | No       |

`controllers` configuration parameters:

| Fields                 | Description                                                        | Default                                                                   | Required |
|------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------|----------|
| name                   | Name to use for this Russound Controller.                          | MCA-88X                                                                   | No       |
| ip                     | IP address of your Russound Controller.                            |                                                                           | Yes      |

`zones` zones parameters:
| Fields                 | Description                                                        | Default                                                                   | Required |
|------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------|----------|
| name                   | Name to of this zone configured on the Russound Controller.        |                                                                           | Yes      |
| display_name           | Name that you want the zone to display.                            | if blank it is name                                                       | No       |
| sources                | List of sources to add to zone.                                    |                                                                           | No       |
| enable                 | Hides zone from Homekit                                            | true                                                                      | No       |

`sources` sources parameters:
| Fields                 | Description                                                        | Default                                                                   | Required |
|------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------|----------|
| name                   | Name to of this source configured on the Russound Controller.      |                                                                           | Yes      |
| display_name           | Name that you want the source name to display                      | if blank it is name                                                       | No       |


## Credits
