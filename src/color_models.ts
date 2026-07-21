import { d, std } from "typegpu";

export type ColorModel = {
    ID: number,
    toRgb(hsl: d.v3f): number
};

export const OkHSL: ColorModel = {
    ID: 0,
    toRgb: okhsl_to_rgb
};

export const HSL: ColorModel = {
    ID: 1,
    toRgb: hsl_to_rgb
};

export const OkHSV: ColorModel = {
    ID: 2,
    toRgb: okhsv_to_rgb
};


interface ModelDict {
    [key: string]: ColorModel
}

export const models: ModelDict = {
    "okhsl": OkHSL,
    "hsl": HSL,
    "okhsv": OkHSV
}

function clamp_pack(rgb: d.v3f) {
    'use gpu';
    const srgba = d.vec4f(
        std.clamp(rgb.r, 0, 1),
        std.clamp(rgb.g, 0, 1),
        std.clamp(rgb.b, 0, 1),
        1
    );
    return std.pack4x8unorm(srgba);
}

// based on https://www.baeldung.com/cs/convert-color-hsl-rgb
// then unnecessarily optimized
function hsl_to_rgb(hsl: d.v3f) {
    'use gpu';

    const h = hsl[0];
    // const s = hsl[1];
    const s = 0.9;
    const l = hsl[2];

    const C = (1 - std.abs(2 * l - 1)) * s // chroma
    const h_prime = h / 60;
    const X = C * (1 - std.abs(h_prime % 2 - 1));
    const m = l - C / 2;

    const band = std.ceil(h_prime) % 6;

    let srgb = d.vec3f(m);
    srgb[std.floor(band / 2)] += C;
    srgb[(5 - band) % 3] += X;

    return clamp_pack(srgb);
}

function okhsl_to_rgb(hsl: d.v3f) {
    'use gpu';
    const oklab = OK.okhsl_to_oklab(hsl);
    const srgb = srgb_gamma(OK.oklab_to_linear_srgb(oklab));
    return clamp_pack(srgb);
}

function okhsv_to_rgb(hsl: d.v3f) {
    'use gpu';
    const oklab = OK.okhsv_to_oklab(hsl);
    const srgb = srgb_gamma(OK.oklab_to_linear_srgb(oklab));
    return clamp_pack(srgb);

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

// Derived from https://github.com/bottosson/bottosson.github.io/blob/master/misc/colorpicker/colorconversion.js
namespace OK {
    const lab_to_lms = d.mat3x3f( // Lab to lms
        0.99999999845051981432, 0.39633779217376785678, 0.21580375806075880339,
        1.0000000088817607767, -0.1055613423236563494, -0.063854174771705903402,
        1.0000000546724109177, -0.089484182094965759684, -1.2914855378640917399
    );
    const lms_to_xyz = d.mat3x3f( // lms to xyz
        1.2268798733741557, -0.5578149965554813, 0.28139105017721583,
        -0.04057576262431372, 1.1122868293970594, -0.07171106666151701,
        -0.07637294974672142, -0.4214933239627914, 1.5869240244272418
    );
    const xyz_to_linear_srgb = d.mat3x3f( // xyz to linear srgb
        3.2409699419045226, -1.537383177570094, -0.4986107602930034,
        -0.9692436362808796, 1.8759675015077202, 0.04155505740717559,
        0.05563007969699366, -0.20397695888897652, 1.0569715142428786
    );
    const lms_to_linear_srgb = lms_to_xyz.mul(xyz_to_linear_srgb);

    export function oklab_to_linear_srgb(Lab: d.v3f) {
        'use gpu';

        const lms = Lab.mul(lab_to_lms);
        return lms.mul(lms).mul(lms) // cube each component
            .mul(lms_to_linear_srgb)
    }

    function toe_inv(x: number) {
        'use gpu';
        return x * (x + 0.206) * 0.854 / (x + 0.03);
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
        // else: using blue default above

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
        const S_cusp = compute_max_saturation(a, b);

        // Convert to linear sRGB to find the first point where at least one of r,g or b >= 1:
        const rgb_at_max = oklab_to_linear_srgb(d.vec3f(1.0, S_cusp * a, S_cusp * b));
        const L_cusp = std.pow(1 / std.max(rgb_at_max[0], rgb_at_max[1], rgb_at_max[2]), 1 / 3);
        const C_cusp = L_cusp * S_cusp;

        return d.vec2f(L_cusp, C_cusp);
    }

    // Finds intersection of the line defined by 
    // L = L0 * (1 - t) + t * L1;
    // C = t * C1;
    // a and b must be normalized so a^2 + b^2 == 1
    function find_gamut_intersection(a: number, b: number, L1: number, C1: number, L0: number, cusp: number[]) {
        'use gpu';

        // Find the intersection for upper and lower half seprately
        if (((L1 - L0) * cusp[1] - (cusp[0] - L0) * C1) <= 0.0) { // Lower half
            const t = cusp[1] * L0 / (C1 * cusp[0] + cusp[1] * (L0 - L1));
            return t;
        }
        else { // Upper half
            // First intersect with triangle
            let t = cusp[1] * (L0 - 1.0) / (C1 * (cusp[0] - 1.0) + cusp[1] * (L0 - L1));

            // Then one step Halley's method
            {
                const dL = L1 - L0;
                const dC = C1;

                const k_lms = d.vec3f(
                    0.3963377774 * a + 0.2158037573 * b,
                    -0.1055613458 * a - 0.0638541728 * b,
                    -0.0894841775 * a - 1.2914855480 * b
                );

                const lms_dt = k_lms.mul(dC).add(dL);


                // If higher accuracy is required, 2 or 3 iterations of the following block can be used:
                {
                    const L = L0 * (1 - t) + t * L1;
                    const C = t * C1;

                    const lms_ = k_lms.mul(C).add(L);
                    const lms = lms_.mul(lms_).mul(lms_);
                    const lmsdt = lms_dt.mul(lms_).mul(lms_).mul(3.0);
                    const lmsdt2 = lms_dt.mul(lms_dt).mul(lms_).mul(6.0);

                    const rgb_mat = d.mat3x3f( // std.transpose has no CPU fallback
                        lms[0], lmsdt[0], lmsdt2[0],
                        lms[1], lmsdt[1], lmsdt2[1],
                        lms[2], lmsdt[2], lmsdt2[2]
                    // const rgb_mat = std.transpose( // this version will work once PR is accepted at https://github.com/software-mansion/TypeGPU/pull/2737
                    //     d.mat3x3f(lms, lmsdt, lmsdt2)
                    ).mul(
                        d.mat3x3f(
                            4.0767416621, -3.3077115913, 0.2309699292, // r coefficients
                            -1.2684380046, 2.6097574011, -0.3413193965, // g
                            -0.0041960863, -0.7034186147, 1.7076147010 // b
                        )
                    );

                    let u_rgb = d.vec3f();
                    let t_rgb = d.vec3f();

                    for (const i of std.range(3)) {
                        let v = d.vec3f(rgb_mat.columns[i]) // data for one color channel
                        v[0] -= 1;
                        u_rgb[i] = v[1] / (v[1] * v[1] - 0.5 * v[0] * v[2]);
                        t_rgb[i] = -v[0] * u_rgb[i];
                    }

                    t_rgb = std.select(
                        t_rgb,
                        d.vec3f(10e5),
                        std.le(u_rgb, d.vec3f(0))
                    );

                    t += std.min(t_rgb.r, t_rgb.g, t_rgb.b);
                }
            }
            return t;
        }
    }

    function get_Cs(L: number, a_: number, b_: number) {
        'use gpu';

        const cusp = find_cusp(a_, b_);

        const C_max = find_gamut_intersection(a_, b_, L, d.f32(1), L, cusp);
        // let ST_max = get_ST_max(cusp);
        const S_max = cusp[1] / cusp[0]; // C/L
        const T_max = cusp[1] / (1 - cusp[0]); // C/(1-L)


        const k = C_max / std.min(L * S_max, (1.0 - L) * T_max);

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

            const C_a = L * S_mid;
            const C_b = (1 - L) * T_mid;

            C_mid = 0.9 * k * std.sqrt(std.inverseSqrt(C_a ** -4 + C_b ** -4));
        }

        let C_0 = d.f32(0);
        {
            const C_a = L * 0.4;
            const C_b = (1 - L) * 0.8;

            C_0 = std.inverseSqrt(C_a ** -2 + C_b ** -2);
        }

        return d.vec3f(C_0, C_mid, C_max);
    }

    export function okhsv_to_oklab(hsv: d.v3f) {
        'use gpu';
        const h = hsv[0];
        // const s = hsv[1]; // always 1.0
        const v = hsv[2];

        const a_ = std.cos(2 * Math.PI * h / 360);
        const b_ = std.sin(2 * Math.PI * h / 360);

        const cusp = find_cusp(a_, b_);
        const L_cusp = cusp[0];
        const C_cusp = cusp[1];

        let L = v * L_cusp;
        let C = v * C_cusp;

        const L_vt = toe_inv(L_cusp);
        const C_vt = C_cusp * L_vt / L_cusp;
        const rgb_scale = oklab_to_linear_srgb(d.vec3f(L_vt, a_ * C_vt, b_ * C_vt));

        const scale_L = std.pow(std.max(rgb_scale.r, rgb_scale.g, rgb_scale.b), -1 / 3);

        const L_new = toe_inv(L) * scale_L;
        C = C * L_new / L;
        L = L_new;

        return d.vec3f(L, C * a_, C * b_);
    }

    export function okhsl_to_oklab(hsl: d.v3f) {
        'use gpu';
        const h = hsl[0];
        // const s = hsl[1]; // always 0.9
        const l = hsl[2];

        if (l % 1 === 0.0) { // l is 0 or 1
            return d.vec3f(l, 0, 0);
        }

        const a_ = std.cos(std.radians(h));
        const b_ = std.sin(std.radians(h));
        const L = toe_inv(l);

        const Cs = get_Cs(L, a_, b_);
        const C_0 = Cs[0];
        const C_mid = Cs[1];
        const C_max = Cs[2];

        // if (s < 0.8) { // given default s = 0.9, never actually used
        //     t = 1.25 * s;
        //     k_0 = 0;
        //     k_1 = 0.8 * C_0;
        //     k_2 = (1 - k_1 / C_mid);
        // }
        // else {
        const t = 0.5; // t = 5.0 * (s - 0.8);
        const k_0 = C_mid;
        const k_1 = 0.3125 * C_mid * C_mid / C_0; // k_1 = 0.2 * C_mid * C_mid * 1.25 * 1.25 / C_0;
        const k_2 = (1.0 - (k_1) / (C_max - C_mid));
        // }

        const C = k_0 + t * k_1 / (1.0 - k_2 * t);

        return d.vec3f(L, C * a_, C * b_);
    }
}