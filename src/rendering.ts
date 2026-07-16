
import { d, type TgpuRoot } from "typegpu";

import Sun from "./sun";
import { OkHSL, HSL, OkHSV } from "./color_models";

namespace Render {
    export type Params = {
        black: number; // threshold below which all colors are treated as black
        night_max: number, // maximum "height" for dark hours
        day_min: number, // minimum height for light hours
        white: number, // threshold above which all colors are treated as white
        gap: number, // transition width between dark and light phases
        model: number, // actually (0 | 1 | 2)
        hue_shift: number,
        mirror_hue: number // actually boolean
    };

    function compress(x: number, params: Params): number {
        'use gpu';

        const x_1 = 0.5 - params.gap / 2;
        const x_2 = 0.5 + params.gap / 2;
        const slope_0 = params.night_max / (x_1 - params.black);
        const slope_1 = (params.day_min - params.night_max) / params.gap;
        const slope_2 = (1 - params.day_min) / (params.white - x_2);

        if (x < params.black) return 0;
        else if (x < x_1) return slope_0 * (x - params.black);
        else if (x < x_2) return params.night_max + slope_1 * (x - x_1);
        else if (x < params.white) return 1 + slope_2 * (x - params.white);
        else return 1;
    }

    export function color_of(coord: Sun.SkyCoord, params: Params) {
        'use gpu';

        let lightness = coord.altitude / 180 + 0.5;
        lightness = compress(lightness, params);
        let hue = (coord.azimuth + params.hue_shift + 360) % 360;
        if (d.bool(params.mirror_hue)) {
            hue = 360 - hue;
        }

        let rgba = d.u32(0);
        if (params.model === OkHSL.ID) {
            rgba = OkHSL.toRgb(d.vec3f(hue, 0.9, lightness))
        } else if (params.model === HSL.ID) {
            rgba = HSL.toRgb(d.vec3f(hue, 0.9, lightness))
        } else {
            rgba = OkHSV.toRgb(d.vec3f(hue, 1.0, lightness));
        }
        return rgba;
    }

    export async function pixels(sun: Sun.SkyGridBuffer, color_options: Params, GPU: TgpuRoot) {
        const pixels = GPU.createMutable(d.arrayOf(d.arrayOf(d.u32, 365), 288));
        const params = GPU.createUniform(
            d.struct({
                black: d.f32,
                night_max: d.f32,
                day_min: d.f32,
                white: d.f32,
                gap: d.f32,
                model: d.u32,
                hue_shift: d.f32,
                mirror_hue: d.u32 // Acting as a bool
            }),
            {
                black: d.f32(color_options.black),
                night_max: d.f32(color_options.night_max),
                day_min: d.f32(color_options.day_min),
                white: d.f32(color_options.white),
                gap: d.f32(color_options.gap),
                model: d.u32(color_options.model),
                hue_shift: d.f32(color_options.hue_shift),
                mirror_hue: d.u32(color_options.mirror_hue)
            }
        );

        const make_colors = GPU.createGuardedComputePipeline(
            (step, day) => {
                'use gpu';
                // swap indices because images are row major
                pixels.$[step][day] = color_of(sun.$[day][step], params.$);
            }
        );
        make_colors.dispatchThreads(288, 365);
        return await pixels.read();
    }

    export function pixels_cpu(sun: Sun.SkyCoord[][], color_options: Params) {
        let pixels: Uint32Array<ArrayBuffer> = new Uint32Array(365 * 288);

        for (const day of Array(365).keys()) {
            for (const step of Array(288).keys()) {
                // swap indices because images are row major
                pixels[step * 365 + day] = color_of(sun[day][step], color_options);
            }
        }
        return pixels;
    }

    let workers: Worker[] = Array(4);

    export function init_workers() {
        for (const slot of workers.keys()) {
            workers[slot] = new Worker(
                /* webpackChunkName: "render_worker" */ new URL("./render_worker.ts", import.meta.url)
            );
        }
    }

    export async function pixels_ww(sun: Sun.SkyCoord[][], color_options: Params) {
        let promises: Promise<Uint32Array<ArrayBuffer>>[] = Array(4);

        for (const chunk of Array(4).keys()) {
            workers[chunk].postMessage({
                sun: sun,
                color_options: color_options,
                chunk: chunk
            });

            promises[chunk] = new Promise( (resolve) => {
                workers[chunk].onmessage = (m) => resolve(m.data);
            });
        }

        let pixels = await Promise.all(promises);
        let pixels_flat = Uint32Array.from(pixels.reduce((prev, curr) => Uint32Array.from([...prev, ...curr])));

        return pixels_flat;
    }
}

export default Render;

