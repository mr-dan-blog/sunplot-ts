
import Color from "colorjs.io";
import type { SkyCoord } from "./sun";



export namespace Colors {
    export type Params = {
        h_1: number,
        h_2: number,
        white: number,
        w: number,
        model: string,
        hue_shift: number,
        mirror_hue: boolean
    };

    // h1 is the maximum "height" for dark hours
    // h2 is the minimum height for light hours
    // sunrise_width measures the transition between the two
    function compress(x: number, params: Params): number {
        const x_1 = 0.5 - params.w / 2;
        const x_2 = 0.5 + params.w / 2;
        const slope_0 = params.h_1 / x_1;
        const slope_1 = (params.h_2 - params.h_1) / params.w;
        const slope_2 = (1 - params.h_2) / (params.white - x_2);
        switch (true) {
            case (x < x_1):
                return slope_0 * x;
            case (x < x_2):
                return params.h_1 + slope_1 * (x - x_1);
            case (x < params.white):
                return 1 + slope_2 * (x - params.white);
            default:
                return 1;
        }
    }

    function color_of(coord: SkyCoord, params: Params): string {
        let lightness = coord.altitude / 360 + 0.5;
        lightness = compress(lightness, params);
        let hue = coord.azimuth + params.hue_shift;
        if (params.mirror_hue) {
            hue *= -1;
        }

        switch (params.model.toLowerCase()) {
            case "okhsl":
                return new Color("okhsl", [hue, 0.9, lightness]).to("oklab").toString();
            case "hsluv":
                return new Color("hsluv", [hue, 90, lightness * 100]).toString({ format: "hex" });
            case "oklch":
                return "oklch(" + lightness + " 0.4 " + hue + ")";
            default:
                return "hsl(" + hue + " 100 " + lightness * 100 + ")";
        }
    }

    export function from(grid: Array<Array<SkyCoord>>, color_options: Params): Array<Array<string>> {
        const days = grid.length;
        const steps_per_day = grid[0].length;

        let colors = [...Array(days)].map(() => Array(steps_per_day));

        for (let day = 0; day < days; day++) {
            for (let step = 0; step < steps_per_day; step++) {
                colors[day][step] = color_of(grid[day][step], color_options);
            }
        }
        return colors;
    }
}