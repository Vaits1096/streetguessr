// Calles famosas para el reto diario y la elección del reto de cada día (igual para todo el mundo).
// [código INE, ciudad, nombre exacto en public/data/m/<INE>.json, nombre a mostrar (si es distinto)]
import { seeded, shuffle } from './rounds.js';

const LIST = [
  ['28079', 'Madrid', 'Gran Vía'], ['28079', 'Madrid', 'Calle Mayor'], ['28079', 'Madrid', 'Calle de Serrano'],
  ['28079', 'Madrid', 'Calle Preciados'], ['28079', 'Madrid', 'Paseo del Prado'], ['28079', 'Madrid', 'Calle de Fuencarral'],
  ['28079', 'Madrid', 'Plaza de la Puerta del Sol', 'Puerta del Sol'], ['28079', 'Madrid', 'Calle de la Cava Baja'],
  ['28079', 'Madrid', 'Calle de Atocha'], ['28079', 'Madrid', 'Paseo de Recoletos'],
  ['08019', 'Barcelona', 'La Rambla'], ['08019', 'Barcelona', 'Passeig de Gràcia'], ['08019', 'Barcelona', 'Via Laietana'],
  ['08019', 'Barcelona', 'Rambla de Catalunya'], ['08019', 'Barcelona', 'Plaça de Catalunya'], ['08019', 'Barcelona', 'Passeig de Colom'],
  ['46250', 'Valencia', 'Carrer de Colón', 'Calle de Colón'], ['46250', 'Valencia', 'Carrer dels Cavallers', 'Calle Caballeros'],
  ['46250', 'Valencia', 'Carrer de la Pau', 'Calle de la Paz'], ['46250', 'Valencia', "Plaça de l'Ajuntament", 'Plaza del Ayuntamiento'],
  ['41091', 'Sevilla', 'Calle Sierpes'], ['41091', 'Sevilla', 'Avenida de la Constitución'], ['41091', 'Sevilla', 'Calle Tetuán'],
  ['41091', 'Sevilla', 'Calle Betis'], ['41091', 'Sevilla', 'Alameda de Hércules'], ['41091', 'Sevilla', 'Calle Feria'],
  ['29067', 'Málaga', 'Calle Marqués de Larios', 'Calle Larios'], ['29067', 'Málaga', 'Paseo del Parque'],
  ['29067', 'Málaga', 'Alameda Principal'], ['29067', 'Málaga', 'Calle Granada'],
  ['48020', 'Bilbao', 'Ledesma kalea', 'Calle Ledesma'], ['48020', 'Bilbao', 'Ercilla kalea', 'Calle Ercilla'],
  ['48020', 'Bilbao', 'Mazarredo zumarkalea', 'Alameda de Mazarredo'],
  ['50297', 'Zaragoza', 'Paseo de la Independencia'], ['50297', 'Zaragoza', 'Calle de Alfonso I'],
  ['50297', 'Zaragoza', 'Plaza de Nuestra Señora del Pilar', 'Plaza del Pilar'], ['50297', 'Zaragoza', 'Calle de Don Jaime I'],
  ['18087', 'Granada', 'Calle Reyes Católicos'], ['18087', 'Granada', 'Paseo de los Tristes'],
  ['18087', 'Granada', 'Calle Carrera del Darro', 'Carrera del Darro'], ['18087', 'Granada', 'Calle Elvira'], ['18087', 'Granada', 'Cuesta de Gomérez'],
  ['37274', 'Salamanca', 'Calle Rúa Mayor', 'Rúa Mayor'], ['37274', 'Salamanca', 'Calle Toro'], ['37274', 'Salamanca', 'Calle Compañía'],
  ['15078', 'Santiago de Compostela', 'Rúa do Franco'], ['15078', 'Santiago de Compostela', 'Rúa do Vilar'],
  ['15078', 'Santiago de Compostela', 'Rúa Nova'], ['15078', 'Santiago de Compostela', 'Praza do Obradoiro'],
  ['26089', 'Logroño', 'Calle de Laurel', 'Calle del Laurel'], ['26089', 'Logroño', 'Calle Portales'], ['26089', 'Logroño', 'Calle San Juan'],
  ['31201', 'Pamplona', 'Estafeta kalea', 'Calle Estafeta'], ['31201', 'Pamplona', 'Mercaderes kalea', 'Calle Mercaderes'],
  ['20069', 'San Sebastián', 'Kontxa pasealekua', 'Paseo de la Concha'], ['20069', 'San Sebastián', 'Abuztuaren 31 kalea', 'Calle 31 de Agosto'],
  ['20069', 'San Sebastián', 'Askatasunaren hiribidea', 'Avenida de la Libertad'], ['20069', 'San Sebastián', 'Boulevard', 'El Boulevard'],
  ['14021', 'Córdoba', 'Calle Cruz Conde'], ['14021', 'Córdoba', 'Calle Judíos'],
  ['45168', 'Toledo', 'Calle Comercio'], ['45168', 'Toledo', 'Plaza de Zocodover'], ['45168', 'Toledo', 'Calle Santo Tomé'],
  ['40194', 'Segovia', 'Calle Real'], ['40194', 'Segovia', 'Calle de Juan Bravo'],
  ['11012', 'Cádiz', 'Calle Ancha'], ['11012', 'Cádiz', 'Calle Columela'], ['11012', 'Cádiz', 'Calle San Francisco'],
  ['33044', 'Oviedo', 'Calle Uría / Cai Uría', 'Calle Uría'], ['33044', 'Oviedo', 'Calle Gascona / Cai La Gascona', 'Calle Gascona'],
  ['24089', 'León', 'Calle Ancha'], ['24089', 'León', 'Avenida de Ordoño II'],
  ['09059', 'Burgos', 'Paseo del Espolón'], ['09059', 'Burgos', 'Calle Laín Calvo'],
  ['15030', 'A Coruña', 'Rúa Real', 'Calle Real'],
  ['07040', 'Palma', 'Passeig del Born'], ['07040', 'Palma', 'Avinguda de Jaume III'],
  ['38038', 'Santa Cruz de Tenerife', 'Calle del Castillo'], ['38038', 'Santa Cruz de Tenerife', 'Rambla de Santa Cruz'],
  ['35016', 'Las Palmas de Gran Canaria', 'Calle Mayor de Triana'], ['35016', 'Las Palmas de Gran Canaria', 'Paseo Las Canteras', 'Paseo de Las Canteras'],
  ['03014', 'Alicante', 'Rambla de Méndez Núñez'], ['03014', 'Alicante', 'Carrer de Castaños', 'Calle Castaños'],
  ['30030', 'Murcia', 'Calle Trapería'], ['30030', 'Murcia', 'Calle Platería'],
  ['47186', 'Valladolid', 'Calle de Santiago'],
  ['17079', 'Girona', 'Rambla de la Llibertat'], ['43148', 'Tarragona', 'Rambla Nova'],
  ['39075', 'Santander', 'Paseo de Pereda'], ['33024', 'Gijón', 'Calle Corrida'],
  ['36057', 'Vigo', 'Rúa do Príncipe', 'Calle del Príncipe'], ['10037', 'Cáceres', 'Calle Pintores'],
  ['01059', 'Vitoria', 'Eduardo Dato kalea', 'Calle Dato'], ['06015', 'Badajoz', 'Calle Menacho'],
];

export const FAMOUS = LIST.map(([cityId, cityName, name, label]) => ({ cityId, cityName, name, label: label || name }));
export const famousLabel = f => `${f.label} · ${f.cityName}`;

export const DAILY_ROUNDS = 5;
export const DAILY_PTS = 100, DAILY_BONUS = 100;   // por acierto, más hasta 100 por rapidez (lo comprueba firestore.rules)

/** Día del reto: días desde 1970 según la fecha de España (cambia a medianoche hora peninsular). */
export function todayNumber(date = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}
export const dayLabel = day => new Date(day * 86_400_000).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * `n` calles famosas de ciudades distintas, cada una con 4 opciones (calles famosas de otras ciudades).
 * [{ famous, options: [famous…], answer: índice }]
 */
export function pickFamous(n, random = Math.random) {
  const pool = shuffle([...FAMOUS], random);
  const picks = [];
  for (const f of pool) {
    if (picks.length === n) break;
    if (!picks.some(p => p.cityId === f.cityId)) picks.push(f);
  }
  return picks.map(f => {
    const others = [];
    for (const o of shuffle(FAMOUS.filter(x => x.cityId !== f.cityId), random)) {
      if (others.length === 3) break;
      if (!others.some(x => x.cityId === o.cityId)) others.push(o);
    }
    const options = shuffle([f, ...others], random);
    return { famous: f, options, answer: options.indexOf(f) };
  });
}

/** Las calles del reto de un día: la misma salida para todo el mundo ese día. */
export const dailyRounds = day => pickFamous(DAILY_ROUNDS, seeded(day * 7919 + 17));

/**
 * Rondas del 1 vs 1 con calles famosas, en el formato que usa el árbitro:
 * { cityId, street (nombre en los datos), target (texto de la opción correcta), options: [textos] }
 */
export const famousVersusRounds = (n, random = Math.random) => pickFamous(n, random).map(r => ({
  cityId: r.famous.cityId, street: r.famous.name, target: famousLabel(r.famous), options: r.options.map(famousLabel),
}));

/** Puntos de un acierto según los segundos tardados: 100 + hasta 100 (pierde 5 por segundo a partir de los 3 s). */
export const dailyPoints = (ok, ms) => (ok ? DAILY_PTS + Math.max(0, DAILY_BONUS - Math.max(0, Math.floor(ms / 1000) - 3) * 5) : 0);
