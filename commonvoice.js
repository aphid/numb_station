import * as readline from 'node:readline/promises';
import * as fs from 'fs';
import { parse } from 'numbers-from-words';

console.log(readline)

/*[
  'client_id',       'path',
  'sentence_id',     'sentence',
  'sentence_domain', 'up_votes',
  'down_votes',      'age',
  'gender',          'accents',
  'variant',         'locale',
  'segment'
]*/


var linen = 0;
let lines = [];





let processLine = async function (line) {
    let data = {};
    data.id = line[0];
    data.filename = line[1];
    data.sentence = line[3];
    data.upv = line[5];
    data.downv = line[6];
    data.age = line[7];
    data.gender = line[8];
    data.accent = line[9];
    data.variant = line[10];
    data.locale = line[11];
    data.segment = line[12]
    /* if (linen >= 1000) {
        console.log(lines);
        process.exit();
    }*/
    let numb;
    //console.log("Trying", data.sentence);
    try {
        numb = await parse(data.sentence);
        data.NUMBER = numb;
    } catch (e) {
        console.log("bawooga");
        console.log(e._detail);
        if (e._detail == "parsed magnitude without number") {
            numb = "magnitude";
            console.log(numb);
        } else if (e._detail == "parsed two numbers in a row" || e._detail == "parsed a number before a multiple" || e._detail == "parsed two multiples in a row") {
            numb = "mult";
            console.log(numb);
        } else {
            console.log("womp");
            throw (e);
        }
    }
    if (numb) {
        console.log("!!!!!", numb);
        lines.push(data);

    }

    /*
    if (data.sentence.includes)
        let words = data.sentence.split(" ");
    let formats = [".m4a", ".flac", ".aac", ".opus", ".ogg", ".mp3"];
    let numbers = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
    let files = fs.readdirSync(dir).filter((word) => (formats.some(format => word.includes(format))));
    
     
    //let files = fs.readdirSync(dir).filter((word) => (formats.some(format => word.includes(format))));
    */
    linen++;
}

let done = async function () {
    console.log("DONE");
    console.log(lines.length);
    fs.writeFileSync("CVnumbers.json", JSON.stringify(lines, undefined, 2));
}

let processTSV = async function (file) {

    let rl = readline.createInterface({ input: fs.createReadStream(file) });
    for await (const line of rl) {
        await processLine(line.split("\t"));
    }
    fs.writeFileSync("cv_full.json", (JSON.stringify(lines, undefined, 2)));

};

let loadJSON = async function (){
    let data = fs.readFileSync("cv_full.json");
    data = JSON.parse(data);
    
    for (let d of data){
        let target = "sources/cv-corpus-22.0-2025-06-20-en/cv-corpus-22.0-2025-06-20/en/clips/" + d.filename;
        fs.copyFileSync(target, "sources/cvEn/" + d.filename);
        console.log("copying", target)
    }
}

loadJSON();

//processTSV("sources/cv-corpus-22.0-2025-06-20-en/cv-corpus-22.0-2025-06-20/en/validated.tsv");
