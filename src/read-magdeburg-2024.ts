import { TreeClassification, TreeRecord } from './model';
import * as fs from 'fs';
import { parse, ParseConfig } from 'papaparse';
import { nanoid } from 'nanoid';


type OriginalTree2024CsvRecord = {
    fid: number;
    Baumnummer: string;
    Gattung: string;
    Stammumfang: number;
    Baumhoehe: number;
    Kronendurchmesser: number;
    Pflanzjahr: number;
    Objekt: string;
    Art: string;
    longitude: number;
    latitude: number;
};


const IGNORED_ADDRESS_WORDS = [
    'Bäume - Liegenschaftsservice',
    '/KGA',
    '/LSG',
    '/PPL',
    '/SBG',
    '/SF',
    '/SP',
];


const GENUS_TRANSLATE_MAP = new Map([
    ['Ostrya carpinifolia - Hopfenbuche', 'Ostrya carpinifolia, Hopfenbuche'],
    ['unbekannt', null],
    ['Unbekannt', null],
    ['waldartiger Bestand', null],
    ['Leerstelle', null],
    ['Baumgruppe', null],
    [' ', null]
]);


export function readMagdeburg2024(inputCsvFile: string): TreeRecord[] {

    const loadedTrees = loadTrees2024(inputCsvFile);
    const validTrees = filterInvalidTrees(loadedTrees);
    const fixedTrees = fixTrees(validTrees);

    return transformTrees(fixedTrees);

}


function loadTrees2024(filename: string): OriginalTree2024CsvRecord[] {
    const csv = fs.readFileSync(filename, 'utf-8');
    const parseOptions: ParseConfig = {
        skipEmptyLines: true,
        header: true,
        transform: (value: string, field: string | number): any => {
            switch (field) {
                case 'Baumnummer':
                    const [_, baumnummer] = value.split('-');
                    if (!baumnummer) {
                        return null;
                    }
                    const trimmed = baumnummer.trim();
                    return trimmed.startsWith('Lieg') ? `L${trimmed.slice(4)}` : trimmed;
                case 'Baumhoehe':
                    return value ? parseFloat(value.replace(',', '.')) : null;
                case 'Kronendurchmesser':
                    return value ? parseFloat(value) : null;
                case 'Stammumfang':
                    return value ? parseInt(value, 10) : null;
                case 'Pflanzjahr':
                    return value ? parseInt(value, 10) : null;
                default:
                    return value;
            }
        }
    };
    return parse(csv, parseOptions).data as OriginalTree2024CsvRecord[];
}


function filterInvalidTrees(trees: OriginalTree2024CsvRecord[]): OriginalTree2024CsvRecord[] {

    const hashId = (tree: OriginalTree2024CsvRecord): string => `${tree.Art}${tree.Baumnummer}`;

    const cntIds = trees
        .map(hashId)
        .sort()
        .reduce((p, c) => {
            p[c] = (p[c] || 0) + 1;
            return p;
        }, {});

    return trees.filter(
        tree =>
            tree.Baumnummer
            && tree.Baumnummer.length > 3
            && tree.Gattung !== 'Leerstelle'
            && cntIds[hashId(tree)] === 1
    );

}


function fixTrees(trees: OriginalTree2024CsvRecord[]): OriginalTree2024CsvRecord[] {

    return trees.map(tree => {
        return {
            ...tree,
            Objekt: fixStrasse(tree.Objekt),
            Gattung: fixGattung(tree.Gattung),
            Pflanzjahr: fixPflanzjahr(tree.Pflanzjahr)
        } satisfies OriginalTree2024CsvRecord;
    });

}


function fixStrasse(strasse: string): string {
    let resultStrasse = strasse;
    IGNORED_ADDRESS_WORDS.forEach(word => resultStrasse = resultStrasse.replace(word, '').trim());
    return resultStrasse;
}


function fixGattung(gattung: string): string {
    return GENUS_TRANSLATE_MAP.has(gattung) ? GENUS_TRANSLATE_MAP.get(gattung) : gattung;
}


function fixPflanzjahr(pflanzjahr: number): number {
    if (!pflanzjahr) {
        return null;
    }

    if (pflanzjahr < 100) {
        return pflanzjahr + 2000;
    }

    return pflanzjahr < 1600 ? null : pflanzjahr;
}


function transformTrees(trees: OriginalTree2024CsvRecord[]): TreeRecord[] {

    return trees.map(tree => {

        const classification = mapToClassification(tree.Gattung);
        return {
            internal_ref: nanoid(),
            ref: tree.Baumnummer,
            location: tree.Art,
            address: tree.Objekt,
            lat: tree.latitude,
            lon: tree.longitude,
            genus: classification.genus,
            species: classification.scientific,
            common: classification.common,
            height: tree.Baumhoehe,
            crown: tree.Kronendurchmesser,
            dbh: tree.Stammumfang / Math.PI,
            planted: tree.Pflanzjahr
        };

    });

}


function mapToClassification(input: string): TreeClassification {

    if (!input) {
        return { fullname: null, genus: null, species: null, variety: null, scientific: null, common: null };
    }

    const parts = input.split(',');
    const scientific = parts.length > 0 ? parts[0].trim() : '';
    const common = parts.length > 1 ? parts[1].trim() : scientific;

    const scientificParts = (parse(scientific, { delimiter: ' ', quoteChar: '"' }).data)[0] as string[];
    const genus = scientificParts[0];
    const species = scientificParts[1].toLowerCase() === 'x'
        ? `x ${scientificParts[2]}`
        : scientificParts[1];
    const variety = scientificParts[1].toLowerCase() === 'x'
        ? scientificParts.slice(3).join(' ')
        : scientificParts.slice(2).join(' ');

    return { fullname: input, genus, species, variety, scientific, common };

}
