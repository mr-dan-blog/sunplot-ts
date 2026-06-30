
import { d, type TgpuRoot } from "typegpu";
import Sun from "./sun";
import { OkHSL, HSL } from "./color_spaces";

namespace Render {
    export type Params = {
        black: number; // threshold below which all colors are treated as black
        h_1: number, // maximum "height" for dark hours
        h_2: number, // minimum height for light hours
        white: number, // threshold above which all colors are treated as white
        gap: number, // transition width between dark and light phases
        model: number, // actually (0 | 1)
        hue_shift: number,
        mirror_hue: number // actually boolean
    };

    function compress(x: number, params: Params): number {
        'use gpu';

        const x_1 = 0.5 - params.gap / 2;
        const x_2 = 0.5 + params.gap / 2;
        const slope_0 = params.h_1 / (x_1 - params.black);
        const slope_1 = (params.h_2 - params.h_1) / params.gap;
        const slope_2 = (1 - params.h_2) / (params.white - x_2);

        if (x < params.black) return 0;
        else if (x < x_1) return slope_0 * (x - params.black);
        else if (x < x_2) return params.h_1 + slope_1 * (x - x_1);
        else if (x < params.white) return 1 + slope_2 * (x - params.white);
        else return 1;
    }

    function color_of(coord: Sun.SkyCoord, params: Params) {
        'use gpu';

        let lightness = coord.altitude / 180 + 0.5;
        lightness = compress(lightness, params);
        let hue = (coord.azimuth + params.hue_shift + 360) % 360;
        if (d.bool(params.mirror_hue)) {
            hue = 360 - hue;
        }
        
        let rgba = d.u32(0);
        if (params.model === HSL.ID) {
            rgba = HSL.toRgb(d.vec3f(hue, 0.9, lightness))
        } else {
            rgba = OkHSL.toRgb(d.vec3f(hue, 0.9, lightness));
        }
        return rgba;
    }

    export async function pixels(sun: Sun.SkyGridBuffer, color_options: Params, GPU: TgpuRoot) {
        const pixels = GPU.createMutable(d.arrayOf(d.arrayOf(d.u32, 365), 288));
        const params = GPU.createUniform(
            d.struct({
                black: d.f32,
                h_1: d.f32,
                h_2: d.f32,
                white: d.f32,
                gap: d.f32,
                model: d.u32,
                hue_shift: d.f32,
                mirror_hue: d.u32 // Acting as a bool
            }),
            {
                black: d.f32(color_options.black),
                h_1: d.f32(color_options.h_1),
                h_2: d.f32(color_options.h_2),
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
}

export default Render;

