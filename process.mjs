import * as fs from 'fs';
import * as Echogarden from 'echogarden';
import { encodeWaveFromFloat32Channels } from '@echogarden/wave-codec'
import { exiftool } from "exiftool-vendored";
import filenamify from 'filenamify';
import * as cp from 'child_process';

//move these to settings, yeah?
const sourceDir = "sources/";
const dataDir = "data/";
const tempDir = "temp/";
const segsDir = "segs/";
const scramDir = "scram/"

let recordings = [];
let collections = [];

let Collection = function (name, path, meta) {
    this.name = name;
    this.sourceDir = sourceDir + path;
    this.targetDir = segsDir + path;
    if (!fs.existsSync(this.sourceDir)) {
        throw (`${this.sourceDir} not found.`)
    }
    if (!fs.existsSync(this.targetDir)) {
        fs.mkdirSync(this.targetDir);
    }
    console.log("meta", meta);
    if (meta) {
        this.meta = meta;
    }
    this.recordings = [];
};


const sleep = ms => new Promise(r => setTimeout(r, ms));


let Recording = function (name, path, target) {
    this.name = name.substring(0, name.lastIndexOf('.')) || name;
    this.path = path;
    this.wav = tempDir + this.name + ".wav";
    this.opus = tempDir + this.name + ".opus";
    this.seg = target + this.name + ".opus";
    this.dataFile = "data/" + this.name + ".json";
    this.finishedNumbers = [];
    this.targetDir = target;
    this.numbLang = JSON.parse(fs.readFileSync("numbers.json"));
}

let numbers = [];

Recording.prototype.getMeta = async function () {

    let meta = await exiftool.read
    if (fs.existsSync(this.dataFile)) {
        meta = JSON.parse(fs.readFileSync(this.dataFile));
    } else {
        meta = await exiftool.read(this.path);
        delete meta.SourceFile;
        delete meta.Directory;
    }
    this.meta = meta;

    return Promise.resolve();
}


Recording.prototype.choplist = async function () {
    //this.data -> timeline (transcript) -> timeline (segment) -> timeline (sentence) -> timeline (word)
    let words = this.data.wordTimeline;
    //console.log(this.data)
    //console.log(words);
    if (!words.length) {
        return Promise.resolve();
    }
    for (let word of words) {
        if (this.numberWang(word.text)) {
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
    if (!this.chopMeta) {
        this.chopMeta = [];
    }
    if (this.finishedNumbers.includes(chop.startTime)) {
        console.log(this.finishedNumbers, chop.startTime);
        //await sleep(15000);
        return Promise.resolve();
    }
    this.finishedNumbers.push(chop.startTime);
    console.log("FINISHED", this.finishedNumbers)

    let infile = `${this.opus}`;
    let chopname = `${chop.text}_${chop.confidence}_${chop.lang}_${chop.source}_${chop.startTime}`;
    let outfile = `${this.targetDir}${chopname}.opus`;
    //let outfile = `${this.seg}`;
    let duration = chop.endTime - chop.startTime;
    if (!duration) {
        //console.log("no duration", chop);
        return Promise.resolve();
    }
    if (fs.existsSync(outfile)) {
        //console.log(chop)
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
        //console.log(doTheThing);
    } catch (e) {
        throw (e);
    }

    let deets = {};
    deets.name = chopname;
    deets.number = chop.text;
    deets.source = chop.source;
    deets.startTime = chop.startTime;
    deets.endTime = chop.endTime;
    deets.lang = chop.lang;
    deets.confidence = chop.confidence;
    deets.outfile = outfile;
    chop.file = outfile;
    chop.source = infile;
    chop.meta = deets;
    await this.scramble(deets);
    fs.writeFileSync(`data/${this.name}_chops.json`, JSON.stringify(deets, undefined, 2));
    this.chopMeta.push(deets);

    return Promise.resolve();
}

Recording.prototype.numberWang = function (word) {
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
    return false;
}


Recording.prototype.doTheChops = async function () {
    await this.choplist();
    await this.chopchop();

};



Recording.prototype.listen = async function () {


    console.log("working with", this.path);
    //await sleep(5000);
    //let denoise = await Echogarden.denoise(this.path);
    let recog;
    try {
        recog = await Echogarden.recognize(this.path, { isolate: true, "whisper.timestampAccuracy": "high" });
    } catch (e) {
        console.log("uh oh error");
        console.error(e);
        recog = await Echogarden.recognize(this.path, { isolate: true, language: "english", "whisper.timestampAccuracy": "high" });
    }
    //console.log(recog);
    //comes in with recog.inputRawAudio, isolatedRawAudio, and backgroundRawAudio
    const waveData = encodeWaveFromFloat32Channels(recog.isolatedRawAudio.audioChannels, recog.isolatedRawAudio.sampleRate);
    this.wav = tempDir + this.name + ".wav";
    console.log("writing", this.wav, waveData.length);

    fs.writeFileSync(this.wav, waveData, 'binary');
    await this.transcode(this.wav, this.opus);
    try {
        fs.unlinkSync(this.wav);
    } catch (e) {
        console.log("tried to delete " + this.wav);
    }
    this.data = recog;
    fs.writeFileSync(this.dataFile, JSON.stringify(recog, replace, 2));
    await this.doTheChops();
    //fs.writeFileSync(this.name + "_chops.json", JSON.stringify(this.chopMeta, undefined, 2));
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
    //fs.unlinkSync(input);
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
    if (!fs.existsSync(this.dataFile) || !fs.existsSync(this.opus)) {
        console.log("no files for", this.name);
        console.log(this.dataFile, this.opus);
        await this.listen();
    } else {
        this.data = JSON.parse(fs.readFileSync(this.dataFile));
    }
}

let recogs = 0;
let aligns = 0;

Recording.prototype.scramble = async function (chop) {
    console.log("🍳🍳🍳 SCRAMBLE TIME 🍳🍳🍳");
    //await sleep(8000);
    /*     
    deets.name = chopname
    deets.number = chop.text;
    deets.source = chop.source;
    deets.startTime = chop.startTime;
    deets.endTime = chop.endTime;
    deets.lang = chop.lang;
    deets.confidence = chop.confidence;
    deets.outfile = outfile;
    */
    this.scrambleDir = `./temp/${this.name}/`;
    if (!fs.existsSync(this.scrambleDir)) {
        fs.mkdirSync(this.scrambleDir);
    }
    let outfile = `${this.scrambleDir}/${chop.name}`;
    let cmd = `"/home/aphid/projects/scrambler/.scramblr/bin/python3" "/home/aphid/projects/scrambler/scrambler.py" "${chop.outfile}" "${outfile}"`;
    try {
        console.log(cmd);
        let thecmd = cp.execSync(cmd).toString();
        console.log(thecmd);
    } catch (e) {
        console.error(e);
    }
    let cS = await this.checkScram(chop);
    if (!cS) {
        return Promise.resolve();
    }

    for (let file of fs.readdirSync(this.scrambleDir).filter((fname) => fname.includes(this.name) && fname.includes(chop.startTime))) {
        console.log("🛑🛑🛑🛑🛑")
        console.log(file);
        console.log(chop);
        let eg;
        let number = false;
        eg = await Echogarden.recognize(`${this.scrambleDir}/${file}`, { "whisper.timestampAccuracy": "high" });
        let nw;
        if (eg.wordTimeline[0].text !== undefined) {
            nw = this.numberWang(eg.wordTimeline[0].text);
        } else {
            continue;
        }
        console.log(nw);
        if (nw) {
            recogs++;
            number = eg.wordTimeline[0].text;
            console.log(eg.wordTimeline[0].text, number);
            console.log(`🦪🦪🦪🦪🦪${recogs}    ${number}`);

        } else {
            eg = await Echogarden.align(`${this.scrambleDir}/${file}`, chop.number, { "whisper.timestampAccuracy": "high" });
            if (eg.wordTimeline[0].text !== undefined) {
                nw = this.numberWang(eg.wordTimeline[0].text);
            } else {
                continue;
            }
            console.log(nw);
            if (nw) {
                aligns++;
                number = eg.wordTimeline[0].text;
                console.log(eg.wordTimeline[0].text, number);
                console.log(`🐌🐌🐌${aligns}    ${number}`);
            }

        }
        //await sleep(15000);
        console.log(eg.wordTimeline[0].text);
        if (number && cS) {
            console.log(chop);

            let chopname = `${number}_${chop.number}_${chop.confidence}_${chop.lang}_${chop.source}_${chop.startTime}`;

            let outfile = `${scramDir}${chopname}.wav`;
            let cmd = `ffmpeg -i "${this.scrambleDir}${file}" -f wav -bitexact -acodec pcm_s16le -ar 22050 -ac 1 "${outfile}"`
            console.log(cmd);

            try {
                let doTheThing = cp.execSync(cmd).toString();
                console.log(doTheThing);
                if (doTheThing.includes("nothing was encoded")) {
                    process.exit();
                }
            } catch (e) {
                throw (e);
            }
            //THE FINAL SCRAMBLE;
            return Promise.resolve();
        }
        //process.exit();
    }
}

Recording.prototype.checkScram = async function (chop) {
    let files = fs.readdirSync(scramDir).filter((fname) => fname.includes(this.name));
    console.log(files, chop.startTime);
    for (let file of files) {
        console.log(file, chop.startTime);
        if (file.includes(chop.startTime)) {
            console.log("🙀🙀🙀🙀🙀🙀🙀🙀🙀", scramDir, file);
            console.log("prevented block", chop.startTime, this.name);
            await sleep(8500);
            return false;
        }
    }
    return true;
}
Collection.prototype.parseDir = async function () {
    let dir = this.sourceDir;
    console.log("Checking ", dir);
    let formats = [".m4a", ".flac", ".aac", ".opus", ".ogg", ".mp3"];
    let files = fs.readdirSync(dir).filter((word) => (formats.some(format => word.includes(format))));
    for (let f of files) {
        console.log(".");

        let record = new Recording(filenamify(f), dir + f, this.targetDir);
        await record.getMeta();
        await record.record();

        this.recordings.push(record);
    }
    console.log("Found", this.recordings.length, "recordings");
    return Promise.resolve();
}


let conetMeta = { name: "conet" };
let conet = collect("conet", "conet/", conetMeta);
//let hibabe = collect("hibabe", "ssas/", conetMeta);
//let joy = collect("joychannel", "jc/", conetMeta);
//let ejt = collect("ejt", "ejt/", conetMeta);
//let rr = collect("rr", "rr/", conetMeta);
//let mem = collect("mem", "mem/", conetMeta);
//let drs = collect("drs", "drs/", conetMeta);

//let reading = collect("unburn", "reading_metadata/", conetMeta);
//let cvEn = collect("cvEn", "cvEn/", conetMeta)
console.log(collections);
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
