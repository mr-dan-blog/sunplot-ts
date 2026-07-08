import { tgpu, type TgpuRoot } from "typegpu";

import Sun from "./sun";
import Render from "./rendering";
import { models } from "./color_models";
import { refresh_brightness } from "./brightness";
import "./sunplot.css";


async function calculate_sun() {
    if (GPU != null) {
        calculated_grid = await Sun.grid(astro_params, GPU);
    } else {
        calculated_grid_cpu = Sun.grid_cpu(astro_params);
    }
}

async function draw() {
    // const start = performance.now();

    if (!all_valid()) {
        console.debug("invalid parameter")
        return;
    }

    let packed: Uint32Array<ArrayBuffer>;
    if (GPU != null) {
        let pixels = await Render.pixels(calculated_grid, color_params, GPU);
        packed = new Uint32Array(pixels.flat().flat());
    } else {
       packed = Render.pixels_cpu(calculated_grid_cpu, color_params);
    }
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
        case "white":
        case "hue_shift":
            color_params[field] = +fields[field].value;
            break;
        case "gap":
            color_params.gap = +fields["gap"].value;
            const offset = +(color_params.gap / 2).toFixed(2);
            fields["black"].max = (0.5 - offset).toString();
            fields["white"].min = (0.5 + offset).toString();
            break;
        case "day_min":
            color_params.day_min = +fields["day_min"].value;
            fields["night_max"].max = (color_params.day_min).toString();
        case "night_max":
            const night_max_literal = +fields["night_max"].value;
            // in case they get out of sync
            color_params.night_max = Math.min(night_max_literal, color_params.day_min);
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

    refresh_brightness(color_params);
    if (render) {
        draw();
    }
}

function all_valid() {
    return astro_fields.concat(color_fields).map(id => {
        const e = document.getElementById(id) as HTMLInputElement;
        return e.checkValidity();
    }).every(b => b);
}

let GPU: TgpuRoot | null = null;
try {
    GPU = await tgpu.init()
} catch (error) {
    console.log("WebGPU not available. Falling back to CPU implementation. Expect slow rendering.");
}
const canvas = document.getElementById("output_canvas") as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;


// global variables
let calculated_grid: Sun.SkyGridBuffer;
let calculated_grid_cpu: Sun.SkyCoord[][];

interface HTMLInputDict {
    [key: string]: HTMLInputElement
}

const astro_fields = ["lat", "lon", "start_time", "utc"];
const color_fields = ["black", "night_max", "day_min", "white", "gap", "model", "hue_shift", "mirror_hue"];

let fields: HTMLInputDict = {};
astro_fields.concat(color_fields).forEach((id) => {
    fields[id] = document.getElementById(id) as HTMLInputElement;
});

function set_onchange() {
    astro_fields.forEach((field) => {
        fields[field].addEventListener("input", () => { update_astronomy(field, true) }, { passive: true });
    });
    color_fields.forEach((field) => {
        fields[field].addEventListener("input", () => { update_colors(field, true) }, { passive: true });
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
    night_max: 0.4,
    day_min: 0.6,
    white: 1,
    gap: 0.05,
    model: 0,
    hue_shift: 0,
    mirror_hue: 0,
};
update_colors("all", false);
calculate_and_draw();