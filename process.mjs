import * as fs from 'fs';
import * as Echogarden from 'echogarden';
import { encodeWaveFromFloat32Channels } from '@echogarden/wave-codec'
import { exiftool } from "exiftool-vendored";
import filenamify from 'filenamify';
import * as cp from 'child_process';

//move these to settings, yeah?
const sourceDir = "sources/reading_metadata/";
const dataDir = "data/";
const tempDir = "temp/";
const segsDir = "segs/";

let recordings = [];
let collections = [];

let Collection = function (name, path, meta) {
    this.name = name;
    this.sourceDir = "sources/" + path;
    this.targetDir = "segs/" + path;
    if (!fs.existsSync(this.sourceDir)) {
        throw (`${this.sourceDir} not found.`)
    }
    if (!fs.existsSync(this.targetDir)) {
        fs.mkdirSync(this.targetDir);
    }
    if (meta && meta.length) {
        this.meta = meta;
    }
    this.recordings = [];
};



const sleep = ms => new Promise(r => setTimeout(r, ms));


let Recording = function (name, path, target, meta) {
    this.name = name.substring(0, name.lastIndexOf('.')) || name;
    this.path = path;
    this.meta = meta;
    this.dataFile = dataDir + this.name + ".json";
    this.wav = tempDir + this.name + ".wav";
    this.opus = target + this.name + ".opus";
    this.targetDir = target;
    this.numbLang = JSON.parse(fs.readFileSync("numbers.json"));
}



let numbers = [];

Recording.prototype.choplist = async function () {
    //this.data -> timeline (transcript) -> timeline (segment) -> timeline (sentence) -> timeline (word)
    let words = this.data.wordTimeline;
    console.log(this.data)
    console.log(words);
    if (!words.length) {
        return Promise.resolve();
    }
    for (let word of words) {
        if (this.numberWang(word)) {
            console.log("adding", word.text, "from", this.name); {
                if (word.text.length > 10) {
                    continue;
                }
                word.source = this.name;
                word.lang = this.data.language;
                word.timeline = null;
                word.startTime = word.startTime.toFixed(3);
                word.endTime = word.endTime.toFixed(3);
                word.confidence = word.confidence.toFixed(3);

                word.duration = word.endTime - word.startTime;
                //only do this if it's not a dupe
                if (numbers.indexOf(word) === -1) {
                    numbers.push(word);
                }

            }
        }
    }


    fs.writeFileSync("foundnumbers.json", JSON.stringify(numbers, undefined, 2));
};

Recording.prototype.chopchop = async function () {
    let chops = JSON.parse(fs.readFileSync("foundnumbers.json"));
    chops = chops.filter(chop => chop.source === this.name);
    for (let chop of chops) {
        await this.segment(chop);
    }
}

Recording.prototype.segment = async function (chop) {
    let infile = `${tempDir}${chop.source}.opus`;
    let outfile = `${this.opus}`;
    let duration = chop.endTime - chop.startTime;
    if (!duration) {
        //console.log("no duration", chop);
        return Promise.resolve();
    }
    if (fs.existsSync(outfile)) {
        console.log(chop)
        //throw (`${outfile} exists already, how can this be?!?`);
        return Promise.resolve();
    }
    let cmd = `ffmpeg -ss ${chop.startTime} -i "${infile}" -t ${chop.duration} -b:a 32K "${outfile}"`;
    console.log(cmd, chop.startTime, chop.endTime);
    try {
        let doTheThing = cp.execSync(cmd).toString();
        console.log(doTheThing);
        if (doTheThing.includes("nothing was encoded")) {
            process.exit();
        }
    } catch (e) {
        throw (e);
    }
    cmd = `opustags -s number="${chop.text}" -s source="${chop.source}" -s startTime="${chop.startTime}" -s endTime="${chop.endTime}" -s language="${chop.lang}" -s confidence="${chop.confidence}" -i "${outfile}"`;
    try {
        console.log(cmd);
        let doTheThing = cp.execSync(cmd).toString();
        console.log(doTheThing);
    } catch (e) {
        throw (e);
    }
    return Promise.resolve();
}

Recording.prototype.numberWang = function (wordObj) {
    let word = wordObj.text;
    //console.log(word, "is a number?");

    if (typeof word === "integer" || !isNaN(parseInt(word))) {
        console.log(word, "is a number");
        return true
    }

    let numWords = [];
    let langs = ["English", "Spanish", "French", "German", "Portuguese", "Swedish", "Finnish", "Polish", "Russian", "Polish", "Latin", "Arabic", "Japanese", "Chinese (Mandarin)", "Hindi"];

    for (let lang of langs) {
        let thislang = this.numbLang[lang];
        for (let i = 0; i < 10; i++) {
            if (thislang[i] === word) {
                console.log("matches", lang, word);
                return true;
            }
        }
    }
}


Recording.prototype.doTheChops = async function () {
    await this.choplist();
    await this.chopchop();

};


Recording.prototype.listen = async function () {


    console.log("working with", this.path);
    await sleep(5000);
    //let denoise = await Echogarden.denoise(this.path);
    let recog = await Echogarden.recognize(this.path, { isolate: true });
    console.log(recog);
    //comes in with recog.inputRawAudio, isolatedRawAudio, and backgroundRawAudio
    const waveData = encodeWaveFromFloat32Channels(recog.isolatedRawAudio.audioChannels, recog.isolatedRawAudio.sampleRate);
    this.wav = tempDir + this.name + ".wav";
    console.log("writing", this.wav, waveData.length);

    fs.writeFileSync(this.wav, waveData, 'binary');
    console.log("writing", this.dataFile, recog.length);
    await this.transcode(this.wav, this.opus);
    fs.unlinkSync(this.wav);
    this.data = recog;
    fs.writeFileSync(this.dataFile, JSON.stringify(recog, replace, 2));

    console.log(this);
    await this.doTheChops();
}

Recording.prototype.transcode = async function (input, output) {
    if (fs.existsSync(output)) {
        return Promise.resolve();
    }
    let cmd = `ffmpeg -i "${input}" "${output}"`;
    try {
        cp.execSync(cmd);
    } catch (e) {
        throw (e);
    }
    fs.unlinkSync(input);
}

let replace = function (key, value) {
    if (value.audioChannels) {
        return undefined; sourceDir
    }
    return value;
}


let collect = function (name, path, meta) {
    let c = new Collection(name, path, meta);
    collections.push(c);
    return c;
}


Recording.prototype.record = async function () {
    if (!fs.existsSync(this.data) || !fs.existsSync(this.opus)) {
        console.log("no files for", this.name);
        await this.listen();
    } else {
        this.data = JSON.parse(fs.readFileSync(this.dataFile));
    }
}

Collection.prototype.parseDir = async function () {
    let dir = this.sourceDir;
    console.log("Checking ", dir);
    let formats = [".m4a", ".flac", ".aac", ".opus", ".ogg", ".mp3"];
    let files = fs.readdirSync(dir).filter((word) => (formats.some(format => word.includes(format))));
    for (let f of files) {
        let meta = await exiftool.read(dir + f);
        delete meta.SourceFile;
        delete meta.Directory;
        let record = new Recording(filenamify(f), dir + f, this.targetDir, meta);
        await record.record();
        this.recordings.push(record);
    }
    console.log("Found", this.recordings.length, "recordings");

    return Promise.resolve();
}


let conetMeta = {};
//let conet = collect("conet", "conet/", conetMeta);
//let hibabe = collect("hibabe", "ssas/", conetMeta);
//let joy = collect("joychannel", "jc/", conetMeta);
//let ejt = collect("ejt", "ejt/", conetMeta);
//let rr = collect("rr", "rr/", conetMeta);
//let mem = collect("mem", "mem/", conetMeta);
//let drs = collect("drs", "drs/", conetMeta);

//let reading = collect("unburn", "reading_metadata/", conetMeta);
let cvEn = collect("cvEn", "cvEn/", conetMeta)
for (let c of collections) {
    await c.parseDir();
}

//await conet.parseDir();

/* recording metadata:
    filename, language, langConfidence(?), duration;
*/

/* seg metadata:
    source, sourcelang, seglang, seglangconf, number, numberconf
*/

/*
async function dontRun() {
    let input = "tcp d3 6 english man version 3 irdial [ird059⧸tcp_d3_06_english_man_version_3_irdial.mp3].mp3";
    input = "../isolate/Heft - Beatin' Off [371290883].opus"
    //let denoise = await Echogarden.denoise(input);
    let recog = await Echogarden.recognize(input, { isolate: true });
    console.log(recog);
    const waveData = encodeWaveFromFloat32Channels(recog.backgroundRawAudio.audioChannels, recog.backgroundRawAudio.sampleRate);
    fs.writeFileSync("test.wav", waveData, 'binary');

    //console.log(recog);
    //fs.writeFile("test.opus", recog.isolatedRawAudio)
}


*/