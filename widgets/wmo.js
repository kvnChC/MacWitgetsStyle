// Códigos meteorológicos WMO → icono simbólico y texto en español.
// Compartido por los widgets de clima y pronóstico.

export function wmoIcon(code) {
  if (code === 0) return "weather-clear-symbolic";
  if (code <= 2) return "weather-few-clouds-symbolic";
  if (code === 3) return "weather-overcast-symbolic";
  if (code <= 48) return "weather-fog-symbolic";
  if (code <= 57) return "weather-showers-scattered-symbolic";
  if (code <= 67) return "weather-showers-symbolic";
  if (code <= 77) return "weather-snow-symbolic";
  if (code <= 82) return "weather-showers-symbolic";
  if (code <= 86) return "weather-snow-symbolic";
  if (code >= 95) return "weather-storm-symbolic";
  return "weather-clear-symbolic";
}

const WMO_TEXT = {
  0: "Despejado",
  1: "Mayormente despejado",
  2: "Parcialmente nublado",
  3: "Nublado",
  45: "Niebla",
  48: "Niebla con escarcha",
  51: "Llovizna ligera",
  53: "Llovizna",
  55: "Llovizna intensa",
  56: "Llovizna helada",
  57: "Llovizna helada intensa",
  61: "Lluvia ligera",
  63: "Lluvia",
  65: "Lluvia intensa",
  66: "Lluvia helada",
  67: "Lluvia helada intensa",
  71: "Nieve ligera",
  73: "Nieve",
  75: "Nieve intensa",
  77: "Granos de nieve",
  80: "Aguacero ligero",
  81: "Aguacero",
  82: "Aguacero intenso",
  85: "Aguanieve",
  86: "Aguanieve intensa",
  95: "Tormenta",
  96: "Tormenta con granizo",
  99: "Tormenta intensa",
};

export function wmoText(code) {
  return WMO_TEXT[code] ?? `Código ${code}`;
}
