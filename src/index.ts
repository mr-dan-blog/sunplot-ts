import { tgpu } from "typegpu";
import { Temporal } from "temporal-polyfill";

import Sun from "./sun";
import Render from "./rendering";
import { HSL, OkHSL } from "./color_spaces";


async function calculate_sun() {
    calculated_grid = await Sun.grid(astro_params, GPU);
}

async function draw() {
    const start = performance.now();

    const pixels = await Render.pixels(calculated_grid, color_params, GPU);
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

function update_astronomy(render?: boolean) {
    astro_params = {
        geo: {
            lat: +fields["lat"].value,
            lon: +fields["lon"].value
        },
        start_time: fields["start-time"].value,
        utc: fields["utc"].checked
    }
    if (render) {
        calculate_and_draw();
    }
}

function update_colors(render?: boolean) {
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

const astro_fields = ["lat", "lon", "start-time", "utc"];
const color_fields = ["black", "h_1", "h_2", "white", "gap", "model", "hue", "mirror_hue"];

let fields: HTMLInputDict = {};
astro_fields.concat(color_fields).forEach((id) => {
    fields[id] = document.getElementById(id) as HTMLInputElement;
});

function set_onchange() {
    astro_fields.forEach((field) => {
        fields[field].addEventListener("change", () => { update_astronomy(true) });
    });
    color_fields.forEach((field) => {
        fields[field].addEventListener("change", () => { update_colors(true) });
    });
}

// init
set_onchange();
let astro_params: Sun.Params;
update_astronomy(false);
let color_params: Render.Params;
update_colors(false);
calculate_and_draw();