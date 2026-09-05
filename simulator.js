const mqtt = require('mqtt');

const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const TOPIC_TELEMETRY = 'site/alex/telemetry';

const client = mqtt.connect(MQTT_BROKER, {
  clientId: 'mcu_gw_a4cf12_' + Math.random().toString(16).substring(2, 8)
});

let seq = 4471;
let uptime1 = 8123456;
let uptime2 = 1204320;

function generatePayload() {
  seq++;
  uptime1 += 5;
  uptime2 += 5;

  return {
    schema: 1,
    ts: Math.floor(Date.now() / 1000),
    site: "site-alex-01",
    gw: "gw-a4cf12",
    pump: [
      {
        node: "pump-01",
        addr: 1,
        i: {
          l1: parseFloat((42.0 + Math.random()).toFixed(2)),
          l2: parseFloat((41.8 + Math.random()).toFixed(2)),
          l3: parseFloat((42.3 + Math.random()).toFixed(2)),
          valid: true
        },
        unbal_pct: 1.6,
        state: "running",
        uptime_s: uptime1,
        starts: 1043
      },
      {
        node: "pump-02",
        addr: 2,
        i: {
          l1: parseFloat((18.1 + Math.random()).toFixed(2)),
          l2: parseFloat((18.0 + Math.random()).toFixed(2)),
          l3: parseFloat((18.2 + Math.random()).toFixed(2)),
          valid: true
        },
        unbal_pct: 0.8,
        state: "running",
        uptime_s: uptime2,
        starts: 412
      }
    ],
    seq: seq,
    t: { val: parseFloat((54.0 + Math.random() * 0.5).toFixed(1)), unit: "C", valid: true },
    faults: [],
    diag: {
      vdda_mv: 3287,
      clip_n: 0,
      mb_crc_err: 0,
      fw: 104,
      boot_n: 12,
      uid: "3A1F7C0842",
      rssi: -62,
      heap_free: 148320,
      dropped: 0
    }
  };
}

client.on('connect', () => {
  console.log('MCU Simulator connected.');
  setInterval(() => {
    const payload = generatePayload();
    client.publish(TOPIC_TELEMETRY, JSON.stringify(payload));
    console.log(`[PUB] Gateway ${payload.gw} sent frame ${payload.seq}`);
  }, 5000);
});