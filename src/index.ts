import { tgpu } from "typegpu";

import Sun from "./sun";
import Render from "./rendering";
import { models } from "./color_models";


async function calculate_sun() {
    calculated_grid = await Sun.grid(astro_params, GPU);
}

async function draw() {
    // const start = performance.now();

    const pixels = await Render.pixels(calculated_grid, color_params, GPU);
    const packed = new Uint32Array(pixels.flat().flat());
    const unpacked = new Uint8ClampedArray(packed.buffer);
    const data = new ImageData(unpacked, 365);

    // const end = performance.now();
    // console.debug("calculated colors in", (end - start).toFixed(1), "ms");

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

function update_astronomy(field: string, render?: boolean) {
    switch (field) {
        case "lat":
        case "lon":
            astro_params.geo[field] = +fields[field].value;
            break;
        case "start_time":
            astro_params.start_time = fields["start_time"].value;
            break;
        case "utc":
            astro_params.utc = fields["utc"].checked;
            break;
        case "all":
            astro_fields.forEach(f => { update_astronomy(f, false); });
            break;
    }

    if (render) {
        calculate_and_draw();
    }
}

function update_colors(field: string, render?: boolean) {
    switch (field) {
        case "black":
        case "h_1":
        case "h_2":
        case "white":
        case "gap":
        case "hue_shift":
            color_params[field] = +fields[field].value;
            break;
        case "model":
            const key = fields["model"].value.toLowerCase();
            color_params.model = models[key].ID;
            break;
        case "mirror_hue":
            color_params.mirror_hue = +fields["mirror_hue"].checked
            break;
        case "all":
            color_fields.forEach(f => { update_colors(f, false); });
            break;
    }

    if (render) {
        draw();
    }
}


const GPU = await tgpu.init();
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;


// global variables
let calculated_grid: Sun.SkyGridBuffer;

interface HTMLInputDict {
    [key: string]: HTMLInputElement
}

const astro_fields = ["lat", "lon", "start_time", "utc"];
const color_fields = ["black", "h_1", "h_2", "white", "gap", "model", "hue_shift", "mirror_hue"];

let fields: HTMLInputDict = {};
astro_fields.concat(color_fields).forEach((id) => {
    fields[id] = document.getElementById(id) as HTMLInputElement;
});

function set_onchange() {
    astro_fields.forEach((field) => {
        fields[field].addEventListener("change", () => { update_astronomy(field, true) });
    });
    color_fields.forEach((field) => {
        fields[field].addEventListener("change", () => { update_colors(field, true) });
    });
}

// init
set_onchange();
let astro_params: Sun.Params = {
    geo: { lat: 0, lon: 0 },
    start_time: "2026-01-01T00:00",
    utc: false
};
update_astronomy("all", false);
let color_params: Render.Params = {
    black: 0,
    h_1: 0.4,
    h_2: 0.6,
    white: 1,
    gap: 0.05,
    model: 0,
    hue_shift: 0,
    mirror_hue: 0,
};
update_colors("all", false);
calculate_and_draw();