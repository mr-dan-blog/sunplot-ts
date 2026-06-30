import { d, std } from "typegpu";

export type ColorSpace = {
    ID: number,
    toRgb(hsl: d.v3f): number
};

export const OkHSL: ColorSpace = {
    ID: 0,
    toRgb: okhsl_to_rgb
};

export const HSL: ColorSpace = {
    ID: 1,
    toRgb: hsl_to_rgb
};

// based on https://www.baeldung.com/cs/convert-color-hsl-rgb
// then unnecessarily optimized
function hsl_to_rgb(hsl: d.v3f) {
    'use gpu';

    const h = hsl[0];
    const s = hsl[1];
    const l = hsl[2];

    const C = (1 - std.abs(2 * l - 1)) * s // chroma
    const h_prime = h / 60;
    const X = C * (1 - std.abs(h_prime % 2 - 1));
    const m = l - C / 2;

    const band = std.ceil(h_prime) % 6;

    let rgba = d.vec4f(m, m, m, 1)
    rgba[band / 2] += C;
    rgba[(5 - band) % 3] += X;

    return std.pack4x8unorm(rgba);
}

function okhsl_to_rgb(hsl: d.v3f) {
    'use gpu';
    const oklab = OK.okhsl_to_oklab(hsl);
    const srgb = srgb_gamma(OK.oklab_to_linear_srgb(oklab));
    const srgba = d.vec4f(srgb.r, srgb.g, srgb.b, 1);
    return std.pack4x8unorm(srgba);

}

function srgb_gamma(linear: d.v3f) {
    'use gpu';
    const gamma_inv = 1 / 2.4;
    return d.vec3f(
        1.055 * std.pow(linear.r, gamma_inv) - 0.055,
        1.055 * std.pow(linear.g, gamma_inv) - 0.055,
        1.055 * std.pow(linear.b, gamma_inv) - 0.055
    );
}

// Derived from https://github.com/Remiscan/colori/blob/main/src/ts/ext/okhsl-okhsv-conversion.ts
// itself derived from https://github.com/bottosson/bottosson.github.io/blob/master/misc/colorpicker/colorconversion.js
namespace OK {
    export function oklab_to_linear_srgb(Lab: d.v3f) {
        'use gpu';

        let lms = Lab.mul(d.mat3x3f(
            0.99999999845051981432, 0.39633779217376785678, 0.21580375806075880339,
            1.0000000088817607767, -0.1055613423236563494, -0.063854174771705903402,
            1.0000000546724109177, -0.089484182094965759684, -1.2914855378640917399
        ));
        lms = std.mul(lms, std.mul(lms, lms)); // cube each component
        const xyz = lms.mul(d.mat3x3f(
            1.2268798733741557, -0.5578149965554813, 0.28139105017721583,
            -0.04057576262431372, 1.1122868293970594, -0.07171106666151701,
            -0.07637294974672142, -0.4214933239627914, 1.5869240244272418
        ));

        return xyz.mul(d.mat3x3f(
            3.2409699419045226, -1.537383177570094, -0.4986107602930034,
            -0.9692436362808796, 1.8759675015077202, 0.04155505740717559,
            0.05563007969699366, -0.20397695888897652, 1.0569715142428786
        ));
    }

    function toe_inv(x: number) {
        'use gpu';
        const k_1 = 0.206;
        const k_2 = 0.03;
        const k_3 = (1 + k_1) / (1 + k_2);
        return (x * x + k_1 * x) / (k_3 * (x + k_2));
    }

    // Finds the maximum saturation possible for a given hue that fits in sRGB
    // Saturation here is defined as S = C/L
    // a and b must be normalized so a^2 + b^2 == 1
    function compute_max_saturation(a: number, b: number) {
        'use gpu';
        // Max saturation will be when one of r, g or b goes below zero.
        // Select different coefficients depending on which component goes below zero first
        // default: blue
        let k0 = 1.35733652; let k1 = -0.00915799; let k2 = -1.15130210; let k3 = -0.50559606; let k4 = 0.00692167;
        let wlms = d.vec3f(-0.0041960863, -0.7034186147, 1.7076147010);

        if (-1.88170328 * a - 0.80936493 * b > 1.0) {
            // Red component
            k0 = 1.19086277; k1 = 1.76576728; k2 = 0.59662641; k3 = 0.75515197; k4 = 0.56771245;
            wlms = d.vec3f(4.0767416621, -3.3077115913, 0.2309699292);
        }
        else if (1.81444104 * a - 1.19445276 * b > 1.0) {
            // Green component
            k0 = 0.73956515; k1 = -0.45954404; k2 = 0.08285427; k3 = 0.12541070; k4 = 0.14503204;
            wlms = d.vec3f(-1.2684380046, 2.6097574011, -0.3413193965);
        }
        // else: blue component
        // Approximate max saturation using a polynomial:
        let S = k0 + (k1 * a) + (k2 * b) + (k3 * a * a) + (k4 * a * b);

        // Do one step Halley's method to get closer
        // this gives an error less than 10e6, except for some blue hues where the dS/dh is close to infinite
        // this should be sufficient for most applications, otherwise do two/three steps 
        const k_lms = d.vec3f(
            0.3963377774 * a + 0.2158037573 * b,
            -0.1055613458 * a - 0.0638541728 * b,
            -0.0894841775 * a - 1.2914855480 * b
        );

        {
            const lms_ = k_lms.mul(S).add(1);
            const lms = lms_.mul(lms_).mul(lms_);
            const lms_dS = k_lms.mul(lms_).mul(lms_).mul(3);
            const lms_dS2 = k_lms.mul(k_lms).mul(lms_).mul(6);

            //  unintuitive: vectors become rows of the matrix
            const f = wlms.mul(d.mat3x3f(lms, lms_dS, lms_dS2));

            S = S - f[0] * f[1] / (f[1] * f[1] - 0.5 * f[0] * f[2]);
        }

        return S;
    }

    function find_cusp(a: number, b: number) {
        'use gpu';
        // First, find the maximum saturation (saturation S = C/L)
        let S_cusp = compute_max_saturation(a, b);

        // Convert to linear sRGB to find the first point where at least one of r,g or b >= 1:
        let rgb_at_max = oklab_to_linear_srgb(d.vec3f(1.0, S_cusp * a, S_cusp * b));
        let L_cusp = std.pow(1 / std.max(rgb_at_max[0], rgb_at_max[1], rgb_at_max[2]), 1 / 3);
        let C_cusp = L_cusp * S_cusp;

        return d.vec2f(L_cusp, C_cusp);
    }

    // Finds intersection of the line defined by 
    // L = L0 * (1 - t) + t * L1;
    // C = t * C1;
    // a and b must be normalized so a^2 + b^2 == 1
    // ToDo: make use matrices
    function find_gamut_intersection(a: number, b: number, L1: number, C1: number, L0: number, cusp: number[]) {
        'use gpu';

        // Find the intersection for upper and lower half seprately
        let t = d.f32(0.0);
        if (((L1 - L0) * cusp[1] - (cusp[0] - L0) * C1) <= 0.0) {
            // Lower half
            t = cusp[1] * L0 / (C1 * cusp[0] + cusp[1] * (L0 - L1));
        }
        else {
            // Upper half
            // First intersect with triangle
            t = cusp[1] * (L0 - 1.0) / (C1 * (cusp[0] - 1.0) + cusp[1] * (L0 - L1));

            // Then one step Halley's method
            {
                let dL = L1 - L0;
                let dC = C1;

                let k_l = 0.3963377774 * a + 0.2158037573 * b;
                let k_m = -0.1055613458 * a - 0.0638541728 * b;
                let k_s = -0.0894841775 * a - 1.2914855480 * b;

                let l_dt = dL + dC * k_l;
                let m_dt = dL + dC * k_m;
                let s_dt = dL + dC * k_s;


                // If higher accuracy is required, 2 or 3 iterations of the following block can be used:
                {
                    let L = L0 * (1 - t) + t * L1;
                    let C = t * C1;

                    let l_ = L + C * k_l;
                    let m_ = L + C * k_m;
                    let s_ = L + C * k_s;

                    let l = l_ * l_ * l_;
                    let m = m_ * m_ * m_;
                    let s = s_ * s_ * s_;

                    let ldt = 3.0 * l_dt * l_ * l_;
                    let mdt = 3.0 * m_dt * m_ * m_;
                    let sdt = 3.0 * s_dt * s_ * s_;

                    let ldt2 = 6.0 * l_dt * l_dt * l_;
                    let mdt2 = 6.0 * m_dt * m_dt * m_;
                    let sdt2 = 6.0 * s_dt * s_dt * s_;

                    let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s - 1;
                    let r1 = 4.0767416621 * ldt - 3.3077115913 * mdt + 0.2309699292 * sdt;
                    let r2 = 4.0767416621 * ldt2 - 3.3077115913 * mdt2 + 0.2309699292 * sdt2;

                    let u_r = r1 / (r1 * r1 - 0.5 * r * r2);
                    let t_r = -r * u_r;

                    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s - 1;
                    let g1 = -1.2684380046 * ldt + 2.6097574011 * mdt - 0.3413193965 * sdt;
                    let g2 = -1.2684380046 * ldt2 + 2.6097574011 * mdt2 - 0.3413193965 * sdt2;

                    let u_g = g1 / (g1 * g1 - 0.5 * g * g2);
                    let t_g = -g * u_g;

                    let b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s - 1;
                    let b1 = -0.0041960863 * ldt - 0.7034186147 * mdt + 1.7076147010 * sdt;
                    let b2 = -0.0041960863 * ldt2 - 0.7034186147 * mdt2 + 1.7076147010 * sdt2;

                    let u_b = b1 / (b1 * b1 - 0.5 * b * b2);
                    let t_b = -b * u_b;

                    if (u_r <= 0.0) {
                        t_r = 10e5;
                    }
                    if (u_g <= 0.0) {
                        t_g = 10e5;
                    }
                    if (u_b <= 0.0) {
                        t_b = 10e5;
                    }

                    t += std.min(t_r, t_g, t_b);
                }
            }
        }

        return t;
    }

    function get_Cs(L: number, a_: number, b_: number) {
        'use gpu';

        const cusp = find_cusp(a_, b_);

        const C_max = find_gamut_intersection(a_, b_, L, d.f32(1), L, cusp);
        // let ST_max = get_ST_max(cusp);
        const S_max = cusp[1] / cusp[0]; // C/L
        const T_max = cusp[1] / (1 - cusp[0]); // C/(1-L)


        let k = C_max / std.min(L * S_max, (1.0 - L) * T_max);

        let C_mid = d.f32(0);
        {
            const S_mid = 0.11516993 + 1 / (
                7.44778970 + 4.15901240 * b_
                + a_ * (-2.19557347 + 1.75198401 * b_
                    + a_ * (-2.13704948 - 10.02301043 * b_
                        + a_ * (-4.24894561 + 5.38770819 * b_ + 4.69891013 * a_
                        )))
            );

            const T_mid = 0.11239642 + 1 / (
                1.61320320 - 0.68124379 * b_
                + a_ * (0.40370612 + 0.90148123 * b_
                    + a_ * (-0.27087943 + 0.61223990 * b_
                        + a_ * (0.00299215 - 0.45399568 * b_ - 0.14661872 * a_
                        )))
            );

            let C_a = L * S_mid;
            let C_b = (1 - L) * T_mid;

            C_mid = 0.9 * k * std.sqrt(std.inverseSqrt(1 / C_a ** 4 + 1 / C_b ** 4));
        }

        let C_0 = d.f32(0);
        {
            let C_a = L * 0.4;
            let C_b = (1 - L) * 0.8;

            C_0 = std.inverseSqrt(1 / (C_a * C_a) + 1 / (C_b * C_b));
        }

        return d.vec3f(C_0, C_mid, C_max);
    }

    export function okhsl_to_oklab(hsl: d.v3f) {
        'use gpu';
        const h = hsl[0];
        const s = hsl[1];
        const l = hsl[2];
        if (l === 1.0) {
            return d.vec3f(1, 0, 0);
        }

        else if (l === 0.0) {
            return d.vec3f(0, 0, 0);
        }

        let a_ = std.cos(2 * Math.PI * h / 360);
        let b_ = std.sin(2 * Math.PI * h / 360);
        let L = toe_inv(l);

        let Cs = get_Cs(L, a_, b_);
        let C_0 = Cs[0];
        let C_mid = Cs[1];
        let C_max = Cs[2];

        let t = d.f32(0);
        let k_0 = d.f32(0);
        let k_1 = d.f32(0);
        let k_2 = d.f32(0);
        if (s < 0.8) { // given default s=0.9, never actually used
            t = 1.25 * s;
            k_0 = 0;
            k_1 = 0.8 * C_0;
            k_2 = (1 - k_1 / C_mid);
        }
        else {
            t = 5.0 * (s - 0.8);
            k_0 = C_mid;
            k_1 = 0.2 * C_mid * C_mid * 1.25 * 1.25 / C_0;
            k_2 = (1.0 - (k_1) / (C_max - C_mid));
        }

        let C = k_0 + t * k_1 / (1.0 - k_2 * t);

        // If we would only use one of the Cs:
        //C = s*C_0;
        //C = s*1.25*C_mid;
        //C = s*C_max;
        return d.vec3f(L, C * a_, C * b_);
    }
}