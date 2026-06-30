import { tgpu, d, type TgpuMutable } from "typegpu";
import { Temporal } from "temporal-polyfill";

import { Sun } from "./sun";
import { Colors } from "./rendering";
import { HSL, OkHSL } from "./color_spaces";


async function calculate_sun() {
    calculated_grid = await Sun.grid(geo, Temporal.Instant.from(start_time), GPU);
}

async function draw() {
    const start = performance.now();

    const pixels = await Colors.texture(calculated_grid, color_params, GPU);
    const packed = new Uint32Array(pixels.flat().flat());
    const unpacked = new Uint8ClampedArray(packed.buffer);
    const data = new ImageData(unpacked, 365);

    const end = performance.now();
    console.debug("calculated colors in", (end - start).toFixed(1), "ms");

    requestAnimationFrame(() => {
        ctx.putImageData(data, 0, 0);
    });
}

async function calculate_and_draw() {
    // const start = performance.now();

    await calculate_sun();

    // const end = performance.now();
    // console.debug("calculated sun in", (end - start).toFixed(1), "ms");

    draw();
}

function update_astronomy() {
    geo = {
        lat: +fields["lat"].value,
        lon: +fields["lon"].value
    };
    start_time = fields["start-time"].value + "Z";
    calculate_and_draw();
}

function update_colors() {
    color_params = {
        black: +fields["black"].value,
        h_1: +fields["h_1"].value,
        h_2: +fields["h_2"].value,
        white: +fields["white"].value,
        gap: +fields["gap"].value,
        model: fields["model"].value.toLowerCase() == "okhsl" ? OkHSL.ID : HSL.ID,
        hue_shift: +fields["hue"].value,
        mirror_hue: fields["mirror_hue"].checked ? 1 : 0,
    }
    draw();
}


const GPU = await tgpu.init();
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;


// global variables
let calculated_grid: TgpuMutable<d.WgslArray<d.WgslArray<Sun.GpuSkyCoord>>>;

interface HTMLInputDict {
    [key: string]: HTMLInputElement
}

const astro_fields = ["lat", "lon", "start-time"];
const color_fields = ["black", "h_1", "h_2", "white", "gap", "model", "hue", "mirror_hue"];

let fields: HTMLInputDict = {};
astro_fields.concat(color_fields).forEach((id) => {
    fields[id] = document.getElementById(id) as HTMLInputElement;
});

let geo: Sun.GeoCoord = {
    lat: +fields["lat"].value,
    lon: +fields["lon"].value
};

let start_time = fields["start-time"].value + "Z";

let color_params: Colors.Params = {
    black: +fields["black"].value,
    h_1: +fields["h_1"].value,
    h_2: +fields["h_2"].value,
    white: +fields["white"].value,
    gap: +fields["gap"].value,
    model: fields["model"].value.toLowerCase() == "okhsl" ? OkHSL.ID : HSL.ID,
    hue_shift: +fields["hue"].value,
    mirror_hue: fields["mirror_hue"].checked ? 1 : 0,
}

function set_onchange() {
    astro_fields.forEach((field) => {
        fields[field].addEventListener("change", update_astronomy);
    });
    color_fields.forEach((field) => {
        fields[field].addEventListener("change", update_colors);
    });
}

// init
set_onchange();
calculate_and_draw();