import { Temporal } from "temporal-polyfill";

// Sun calculations based on https://aa.quae.nl/en/reken/zonpositie.html

const J_2000 = 2451545;

function rad(n: number) {
    return n * Math.PI / 180;
}

function deg(n: number) {
    return n * 180 / Math.PI;
}

function sind(n: number) {
    return Math.sin(rad(n));
}

function cosd(n: number) {
    return Math.cos(rad(n));
}

function tand(n: number) {
    return Math.tan(rad(n));
}

function wrap(degrees: number) {
    return ((degrees) + 360) % 360;
}

function reference(degrees: number) {
    return (((degrees % 360) + 180) % 360) - 180
    // return wrap(degrees + 180) - 180;
}

function julian_date(date: Temporal.Instant) {
    const Julian_zero = Temporal.Instant.from("-004713-11-24T12:00Z");
    const seconds = date.since(Julian_zero).seconds;
    return seconds / (60 * 60 * 24);
}

function mean_anomaly(J: number) {
    const M_0 = 357.5291; // mean anomaly on January 1, 2000
    const M_1 = 0.98560028 // derivative of mean anomaly

    return wrap(M_0 + M_1 * (J - J_2000));
}

function true_anomaly(M: number) {
    const C_1 = 1.9148;
    const C_2 = 0.0200;
    const C_3 = 0.0003;
    const C = C_1 * sind(M) + C_2 * sind(2 * M) + C_3 * sind(3 * M);
    return M + C;
}

function longitude(nu: number) {
    const Pi_earth = 102.9373;
    return reference(nu + Pi_earth + 180);
}

function right_ascension(lambda: number) {
    const A_2 = -2.4657;
    const A_4 = 0.0529;
    const A_6 = -0.0014;
    return lambda + A_2 * sind(2 * lambda) + A_4 * sind(4 * lambda) + A_6 * sind(6 * lambda);
}

function declination(lambda: number) {
    const D_1 = 22.7908;
    const D_3 = 0.5991;
    const D_5 = 0.0492;

    const s = sind(lambda);
    return (D_1 * s) + (D_3 * s ** 3) + (D_5 * s ** 5);
}

function siderial_time(J: number, lon: number) {
    const theta_0 = 280.1470;
    const theta_1 = 360.9856235;

    return wrap(theta_0 + theta_1 * (J - J_2000) - lon);
}

export type GeoCoord = { lat: number, lon: number };

export type SkyCoord = { azimuth: number, altitude: number };

function altitude_azimuth(J: number, geo: GeoCoord): SkyCoord {
    const M = mean_anomaly(J);

    const nu = true_anomaly(M);

    const lambda = longitude(nu);

    const alpha = right_ascension(lambda);
    const delta = declination(lambda);

    const theta = siderial_time(J, geo.lon);

    const H = theta - alpha;

    let A = Math.atan2(sind(H), cosd(H) * sind(geo.lat) - tand(delta) * cosd(geo.lat));
    A = deg(A);

    let h = Math.asin(sind(geo.lat) * sind(delta) + cosd(geo.lat) * cosd(delta) * cosd(H));
    h = deg(h);

    return { azimuth: A, altitude: h };
}

export function sun_grid(geo: GeoCoord, start_time: Temporal.Instant, steps_per_day: number): Array<Array<SkyCoord>> {
    let grid = [...Array(365)].map(() => Array(steps_per_day));

    const J_0 = julian_date(start_time);
    let j = J_0;
    const step_size = 1 / steps_per_day;

    let time = start_time;
    for (let day = 0; day < 365; day++) {
        j = J_0 + day;
        for (let step = 0; step < steps_per_day; step++) {
            grid[day][step] = altitude_azimuth(j, geo);
            j += step_size;
        }
    }

    return grid;
}