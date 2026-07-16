import Render from "./rendering";
import type Sun from "./sun";

globalThis.onmessage = (m: MessageEvent<{ sun: Sun.SkyCoord[][], color_options: Render.Params, chunk: number }>) => {
    let pixels: Uint32Array<ArrayBuffer> = new Uint32Array(365 * 288 / 4);

    const offset = m.data.chunk * 288 / 4;

    for (const day of m.data.sun.keys()) {
        for (const step of Array(288 / 4).keys()) {
            pixels[step * 365 + day] = Render.color_of(m.data.sun[day][step + offset], m.data.color_options);
        }
    }

    self.postMessage(pixels);
}