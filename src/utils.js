const fs = require('fs');
const fsPromises = fs.promises;

objectToJsonString = (object) => {
   return JSON.stringify(object, null, 2)
}

saveData = async(path, data) => {
    try {
        data = objectToJsonString(data);
        await fsPromises.writeFile(path, data);
        return true;
    } catch (error) {
        throw new Error(`Save data error: ${error.message || error}`);
    };
}

readData = async (path) => {
    try {
        const data = await fsPromises.readFile(path);
        return data;
    } catch (error) {
        throw new Error(`Read data error: ${error.message || error}`);
    };
}

createFiles = async (logger, files, errorString) => {
    try {
        files.forEach((file) => {
            if (!fs.existsSync(file)) {
                fs.writeFileSync(file, '');
            }
        });
        return true;
    } catch (error) {
        logger.error(`Controller: ${this.controllerName}${errorString ? ', ' + errorString:''}, prepare files error: ${error}`);
        return false;
    }
}

module.exports = {
    objectToJsonString,
    saveData,
    readData,
    createFiles
}