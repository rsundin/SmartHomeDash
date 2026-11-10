// A large, fictional site for the performance test (tests/browser/perf.test.js):
// an overview with 3 buildings, 3 floor plans with 40 rooms, 120 lamps and 60 sensors.
//
//   node tests/fixtures/perf-site.js > site.json     prints the site config
//   require('./perf-site').perfSite()                returns it
//
// The overview reuses the house example's picture; the test serves it from there.

const PLANS = [
  { id: 'main', name: 'Main house', rooms: 14 },
  { id: 'upper', name: 'Upper floor', rooms: 13 },
  { id: 'annex', name: 'Annex', rooms: 13 },
];
// 12 outdoor lamps here plus 108 in rooms: 120 in all.
const OUTDOOR = 12;
// 40 temperature sensors (one per room) plus 20 doors, windows and motion sensors: 60 in all.
const OPENINGS = 20;

function perfSite() {
  const site = {
    name: 'Performance test',
    language: 'en',
    locale: 'en-GB',
    comfort: { low: 19, high: 23 },
    overview: {
      image: 'example_day.jpg',
      night_image: 'example_night.jpg',
      size: [1264, 848],
      buildings: [],
      zones: [],
      windows: [],
      solar: { peak_kw: 8, panels: [[[356, 327], [600, 240], [680, 310], [430, 418]]] },
      energy_points: { house: [800, 405], grid: [905, 840], battery: [296, 440], charger: [1000, 372] },
    },
    floorplans: [],
    energy: {
      load_power: 'sensor.house_power', grid_power: 'sensor.grid_power', pv_power: 'sensor.solar_power',
      battery_power: 'sensor.battery_power', battery_soc: 'sensor.battery_level', charger_power: 'sensor.car_charger_power',
      energy_today: 'sensor.energy_today', cost_today: 'sensor.energy_cost_today',
      price: { entity: 'sensor.electricity_price', today_attribute: 'today' },
    },
    weather: 'weather.home',
    mock: { sensors: {} },
  };

  // Three buildings side by side across the picture.
  const bw = 1264 / 3;
  PLANS.forEach((p, i) => {
    const x0 = Math.round(i * bw + 20), x1 = Math.round((i + 1) * bw - 20);
    site.overview.buildings.push({ id: p.id, name: p.name, floorplan: p.id, area: [[x0, 300], [x1, 300], [x1, 600], [x0, 600]] });
  });

  // Rooms in a grid on a 1200 × 800 px plan. 28 rooms get three lamps, 12 get two.
  let roomNo = 0, sensorNo = 0;
  for (const p of PLANS) {
    const cols = Math.ceil(Math.sqrt(p.rooms * 1.5)), rows = Math.ceil(p.rooms / cols);
    const w = 1200 / cols, h = 800 / rows;
    const plan = { id: p.id, name: p.name, unit: 'px', outline: [[0, 0], [1200, 0], [1200, 800], [0, 800]], rooms: [] };
    for (let r = 0; r < p.rooms; r++) {
      const n = roomNo++;
      const x = (r % cols) * w, y = Math.floor(r / cols) * h;
      const id = `room_${n + 1}`;
      const lamps = n < 28 ? 3 : 2;
      const room = {
        id,
        name: `Room ${n + 1}`,
        area: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => [Math.round(a), Math.round(b)]),
        lights: Array.from({ length: lamps }, (_, k) => ({
          entity: `light.${id}_${k + 1}`, name: `Lamp ${k + 1}`, at: [Math.round(x + (w * (k + 1)) / (lamps + 1)), Math.round(y + h * 0.75)],
        })),
        temperature: `sensor.${id}_temperature`,
      };
      if (n % 4 === 0) room.climate = `climate.${id}`;
      if (sensorNo < OPENINGS && n % 2 === 0) {
        const kind = ['window', 'door', 'motion'][sensorNo % 3];
        const sid = `binary_sensor.${id}_${kind}`;
        room.sensors = [sid];
        site.mock.sensors[sid] = { device_class: kind, state: sensorNo % 5 === 0 ? 'on' : 'off', name: `Room ${n + 1} ${kind}` };
        sensorNo++;
      }
      plan.rooms.push(room);
    }
    site.floorplans.push(plan);
  }

  // Outdoor lamps in four zones of three, each lamp its own light.
  for (let z = 0; z < 4; z++) {
    const id = `outdoor_${z + 1}`;
    const lamps = Array.from({ length: OUTDOOR / 4 }, (_, k) => ({ at: [120 + z * 300 + k * 60, 640], type: k === 1 ? 'ground' : 'wall', size: 30 }));
    site.overview.zones.push({ id, name: `Outdoor ${z + 1}`, lights: lamps.map((_, k) => `light.${id}_${k + 1}`), lamps });
  }
  // A lit window per building, from its first room.
  site.overview.buildings.forEach((b) => {
    const [[x0]] = b.area;
    site.overview.windows.push({ room: site.floorplans.find((p) => p.id === b.id).rooms[0].id, area: [[x0 + 40, 400], [x0 + 80, 400], [x0 + 80, 450], [x0 + 40, 450]] });
  });
  return site;
}

module.exports = { perfSite };

if (require.main === module) process.stdout.write(`${JSON.stringify(perfSite(), null, 2)}\n`);
