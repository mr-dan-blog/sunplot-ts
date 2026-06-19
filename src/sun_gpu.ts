import { Temporal } from "temporal-polyfill";
import tgpu, { d, std } from "typegpu";

// Sun calculations based on https://aa.quae.nl/en/reken/zonpositie.html

// Not true Julian 0, but the formulae use it as such
// Using true Julian 0 results in loss of floating point precision
const Julian_zero = Temporal.Instant.from("2000-01-01T12:00Z");

const M_0 = 357.5291; // mean anomaly on January 1, 2000
const M_1 = 0.98560028; // derivative of mean anomaly

// constants for calculating true anomaly
const C_1 = 1.9148;
const C_2 = 0.0200;
const C_3 = 0.0003;

const Pi_earth = 102.9373; // ecliptic longitude of Earth's perihelion

// constants for calculating right ascension
const A_2 = -2.4657;
const A_4 = 0.0529;
const A_6 = -0.0014;

// constants for calculating declination
const D_1 = 22.7908;
const D_3 = 0.5991;
const D_5 = 0.0492;


const theta_0 = 280.1470; // siderial time angle on January 1, 2000
const theta_1 = 360.9856235; // slope of siderial time

export type GeoCoord = {
    lat: number,
    lon: number
};

export type SkyCoord = {
    azimuth: number,
    altitude: number
};

const GPU = await tgpu.init();

const GpuSkyCoord = d.struct({
    azimuth: d.f32,
    altitude: d.f32
});

const GpuGeoCoord = d.struct({
    lat: d.f32,
    lon: d.f32
});

function sind(n: number) {
    'use gpu';
    return std.sin(std.radians(n));
}

function cosd(n: number) {
    'use gpu';
    return std.cos(std.radians(n));
}

function tand(n: number) {
    'use gpu';
    return std.tan(std.radians(n));
}

function wrap(degrees: number) {
    'use gpu';
    return ((degrees) + 360) % 360;
}

function reference(degrees: number) {
    'use gpu';
    return (((degrees % 360) + 180) % 360) - 180
}

function julian_date(date: Temporal.Instant) {
    const seconds = date.since(Julian_zero).seconds;
    return seconds / (60 * 60 * 24);
}


function altitude_azimuth(J: number, geo: GeoCoord): SkyCoord {
    'use gpu';

    const M = wrap(M_0 + M_1 * (J)); // mean anomaly
    const nu = M + C_1 * sind(M) + C_2 * sind(2 * M) + C_3 * sind(3 * M); // true anomaly
    const lambda = reference(nu + Pi_earth + 180); // ecliptical longitude
    const alpha = lambda + A_2 * sind(2 * lambda) + A_4 * sind(4 * lambda) + A_6 * sind(6 * lambda); // right ascension
    const s = sind(lambda);
    const delta = (D_1 * s) + (D_3 * s ** 3) + (D_5 * s ** 5); // declination
    const theta = wrap(theta_0 + theta_1 * (J) - geo.lon); //siderial time
    const H = theta - alpha;
    
    let A = std.atan2(sind(H), cosd(H) * sind(geo.lat) - tand(delta) * cosd(geo.lat));
    A = std.degrees(A);

    let h = std.asin(sind(geo.lat) * sind(delta) + cosd(geo.lat) * cosd(delta) * cosd(H));
    h = std.degrees(h);

    return { azimuth: A, altitude: h };
}

// Below: GPU versions of things

export async function sun_grid(geo: GeoCoord, start_time: Temporal.Instant): Promise<SkyCoord[][]> {
    const steps_per_day = 288;

    const J_0 = GPU.createUniform(d.f32, julian_date(start_time));
    const step_size = GPU.createUniform(d.f32, 1 / steps_per_day);
    const gpu_geo = GPU.createUniform(GpuGeoCoord, GpuGeoCoord(geo))

    const GpuSunGrid = d.arrayOf(d.arrayOf(GpuSkyCoord, steps_per_day), 365);

    const output_grid = GPU.createMutable(GpuSunGrid);

    const program = GPU.createGuardedComputePipeline(
        (step, day) => {
            'use gpu';
            const J = J_0.$ + d.f32(day) + step_size.$ * d.f32(step);
            const z = GpuSkyCoord(altitude_azimuth(J, gpu_geo.$));
            output_grid.$[day][step] = GpuSkyCoord(z);
        }
    );

    program.dispatchThreads(steps_per_day, 365);

    return await output_grid.read();
}