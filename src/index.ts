import { Temporal } from "temporal-polyfill";

import type { GeoCoord, SkyCoord } from "./sun";
import { sun_grid } from "./sun";

import { Colors } from "./color";

function calculate_sun() {
    const geo: GeoCoord = {
        lat: +(document.getElementById("lat") as HTMLInputElement).value,
        lon: +(document.getElementById("lon") as HTMLInputElement).value!
    };
    const start_time = document.getElementById("start-time") as HTMLInputElement;
    const time = start_time.value + "Z";

    calculated_grid = sun_grid(geo, Temporal.Instant.from(time), 288);
}

function draw_to_canvas(color_grid: Array<Array<string>>, canvas: HTMLCanvasElement): void {
    const days = color_grid.length;
    const steps_per_day = color_grid[0].length;

    canvas.width = days;
    canvas.height = steps_per_day;
    const ctx = canvas.getContext("2d")!;

    for (let day = 0; day < days; day++) {
        for (let step = 0; step < steps_per_day; step++) {
            ctx.fillStyle = color_grid[day][step];
            ctx.fillRect(day, step, 1, 1);
        }
    }
}

function make_image() {
    const color_params: Colors.Params = {
        h_1: +(document.getElementById("h_1") as HTMLInputElement).value,
        h_2: +(document.getElementById("h_2") as HTMLInputElement).value,
        white: +(document.getElementById("white") as HTMLInputElement).value,
        w: +(document.getElementById("gap") as HTMLInputElement).value,
        model: (document.getElementById("model") as HTMLInputElement).value,
        hue_shift: +(document.getElementById("hue") as HTMLInputElement).value,
        mirror_hue: (document.getElementById("mirror_hue") as HTMLInputElement).checked,
    }
    const color_grid = Colors.from(calculated_grid, color_params);
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    draw_to_canvas(color_grid, canvas);
}

var profile = function(f: Function) {
    return function() {
        const timer_start = performance.now();
        const out = f.apply(arguments);
        const timer_end = performance.now();
        console.debug(f.name + ": ", timer_end-timer_start);
        return out;
    }
}

const calc_btn = document.getElementById("calculate")!;
calc_btn.addEventListener("click", profile(calculate_sun));

const draw_btn = document.getElementById("draw")!;
draw_btn.addEventListener("click", profile(make_image));

let calculated_grid: Array<Array<SkyCoord>>;

