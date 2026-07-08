import Render from "./rendering"

function remap_x(x: number): string {
    return (x * 180).toFixed(2);
}

function remap_y(y: number): string {
    return ((1 - y) * 180).toFixed(2);
}

const svgdoc = document.getElementById("svgdoc") as HTMLOrSVGElement as SVGSVGElement;



const circle_black = svgdoc.getElementById("circle1") as SVGCircleElement;
const circle_night_max = svgdoc.getElementById("circle2") as SVGCircleElement;
const circle_day_min = svgdoc.getElementById("circle3") as SVGCircleElement;
const circle_white = svgdoc.getElementById("circle4") as SVGCircleElement;

const connector = svgdoc.getElementById("connector") as SVGPathElement;

export function refresh_brightness(params: Render.Params) {
    const black = remap_x(params.black);
    circle_black.setAttribute("cx", black);

    const night_x = remap_x(0.5 - params.gap / 2);
    const night_max = remap_y(params.night_max);
    circle_night_max.setAttribute("cx", night_x + "px");
    circle_night_max.setAttribute("cy", night_max + "px");

    const day_x = remap_x(0.5 + params.gap / 2);
    const day_min = remap_y(params.day_min);
    circle_day_min.setAttribute("cx", day_x + "px");
    circle_day_min.setAttribute("cy", day_min + "px");

    const white = remap_x(params.white);
    circle_white.setAttribute("cx", white + "px");

    const connector_string = `M0,180 H${black} L${night_x},${night_max} L${day_x},${day_min} L${white},0 H180`;
    connector.setAttribute("d", connector_string);
}