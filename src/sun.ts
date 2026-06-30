import { Temporal } from "temporal-polyfill";
import { d, std, type TgpuRoot } from "typegpu";

// Sun calculations based on https://aa.quae.nl/en/reken/zonpositie.html

const TAU = Math.PI * 2;

// Not true Julian 0, but the formulae use it as such
// Using true Julian 0 results in loss of floating point precision
const Julian_zero = Temporal.Instant.from("2000-01-01T12:00Z");

const M_0 = std.radians(357.5291); // mean anomaly on January 1, 2000
const M_1 = std.radians(0.98560028); // derivative of mean anomaly

// constants for calculating true anomaly
const C_1 = std.radians(1.9148);
const C_2 = std.radians(0.0200);
const C_3 = std.radians(0.0003);

const Pi_earth = std.radians(102.9373); // ecliptic longitude of Earth's perihelion

// constants for calculating right ascension
const A_2 = std.radians(-2.4657);
const A_4 = std.radians(0.0529);
const A_6 = std.radians(-0.0014);

// constants for calculating declination
const D_1 = std.radians(22.7908);
const D_3 = std.radians(0.5991);
const D_5 = std.radians(0.0492);


const theta_0 = std.radians(280.1470); // siderial time angle on January 1, 2000
const theta_1 = std.radians(360.9856235); // slope of siderial time
const theta_1_frac = std.radians(0.9856235); // slope of siderial time


function wrap(radians: number) {
    'use gpu';
    return std.mod(radians + TAU, TAU);
}

function reference(radians: number) {
    'use gpu';
    return std.mod(radians + Math.PI, TAU) - Math.PI;
}

function julian_date(date: Temporal.Instant) {
    const seconds = date.since(Julian_zero).seconds;
    return seconds / (60 * 60 * 24);
}


function altitude_azimuth(J_whole: number, J_frac: number, lon: number, sin_lat: number, cos_lat: number): Sun.SkyCoord {
    'use gpu';

    const M = wrap(M_0 + M_1 * d.f32(J_whole) + M_1 * J_frac); // mean anomaly
    const nu = M + C_1 * std.sin(M) + C_2 * std.sin(2 * M) + C_3 * std.sin(3 * M); // true anomaly
    const lambda = reference(nu + Pi_earth + Math.PI); // ecliptical longitude
    const alpha = lambda + A_2 * std.sin(2 * lambda) + A_4 * std.sin(4 * lambda) + A_6 * std.sin(6 * lambda); // right ascension
    const s = std.sin(lambda);
    const delta = (D_1 * s) + (D_3 * s ** 3) + (D_5 * s ** 5); // declination
    const theta = wrap(theta_0 + theta_1_frac * d.f32(J_whole) + theta_1 * J_frac - lon); //siderial time
    const H = theta - alpha;

    const A = std.atan2(std.sin(H), std.cos(H) * sin_lat - std.tan(delta) * cos_lat);

    const h = std.asin(sin_lat * std.sin(delta) + cos_lat * std.cos(delta) * std.cos(H));

    return Sun.SkyCoordSchema({ azimuth: std.degrees(A), altitude: std.degrees(h) });
}

export namespace Sun {
    export type GeoCoord = {
        lat: number,
        lon: number
    };

    export type GpuSkyCoord = d.WgslStruct<{
        azimuth: d.F32;
        altitude: d.F32;
    }>;

    export type SkyCoord = {
        azimuth: number,
        altitude: number
    };

    export const SkyCoordSchema = d.struct({
        azimuth: d.f32,
        altitude: d.f32
    });

    export const GeoCoordSchema = d.struct({
        lat: d.f32,
        lon: d.f32
    });

    const SunGridSchema = d.arrayOf(d.arrayOf(SkyCoordSchema, 288), 365);

    export async function grid(geo: GeoCoord, start_time: Temporal.Instant, GPU: TgpuRoot) {
        const J_0 = julian_date(start_time);
        const J_0_whole = d.i32(Math.trunc(J_0));
        const J_0_frac = J_0 - d.f32(J_0_whole);

        const step_size = d.f32(1 / 288);

        const lon = std.radians(geo.lon);
        const sin_lat = std.sin(std.radians(geo.lat));
        const cos_lat = std.cos(std.radians(geo.lat));

        // const geo_radians: GeoCoord = {lat: std.radians(geo.lat), lon: std.radians(geo.lon)};
        // const gpu_geo = GPU.createUniform(GeoCoordSchema, GeoCoordSchema(geo_radians))

        const output_grid = GPU.createMutable(SunGridSchema);

        // ToDo precompute sin(geo.lat) and cos(geo.lat) to pass in
        // ToDo use integers to get accurate J_0 even when far from 2000

        const program = GPU.createGuardedComputePipeline(
            (step, day) => {
                'use gpu';
                // const J = J_0 + d.f32(day) + step_size * d.f32(step);
                const J_whole = J_0_whole + d.i32(day);
                const J_frac = J_0_frac + step_size * d.f32(step);
                const z = SkyCoordSchema(altitude_azimuth(J_whole, J_frac, lon, sin_lat, cos_lat));
                output_grid.$[day][step] = SkyCoordSchema(z);
            }
        );

        program.dispatchThreads(288, 365);

        return output_grid;
    }
}