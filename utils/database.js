const initializeDatabase = require('../db_init');

const db = initializeDatabase();

const upsertGateway = db.prepare(`
    INSERT INTO gateways (gw, site, fw, uid, last_seen_ts)
    VALUES (@gw, @site, @fw, @uid, @ts)
    ON CONFLICT(gw) DO UPDATE SET
        site = excluded.site,
        fw = excluded.fw,
        uid = excluded.uid,
        last_seen_ts = excluded.last_seen_ts,
        updated_at = CURRENT_TIMESTAMP
`);

const upsertDevice = db.prepare(`
    INSERT INTO devices (gw, node, site, addr, state, last_seen_ts)
    VALUES (@gw, @node, @site, @addr, @state, @ts)
    ON CONFLICT(gw, node) DO UPDATE SET
        site = excluded.site,
        addr = excluded.addr,
        state = excluded.state,
        last_seen_ts = excluded.last_seen_ts
`);

const insertFrame = db.prepare(`
    INSERT INTO telemetry_frames (site, gw, seq, ts, temp_val, temp_unit, temp_valid, vdda_mv, rssi, heap_free, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertReading = db.prepare(`
    INSERT INTO device_readings (frame_id, gw, node, state, i_l1, i_l2, i_l3, i_valid, unbal_pct, uptime_s, starts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const savePayloadTransaction = db.transaction((payload) => {
    upsertGateway.run({
        gw: payload.gw,
        site: payload.site,
        fw: payload.diag?.fw ?? null,
        uid: payload.diag?.uid ?? null,
        ts: payload.ts,
    });

    const frameRes = insertFrame.run(
        payload.site,
        payload.gw,
        payload.seq,
        payload.ts,
        payload.t?.val ?? null,
        payload.t?.unit ?? 'C',
        payload.t?.valid ? 1 : 0,
        payload.diag?.vdda_mv ?? null,
        payload.diag?.rssi ?? null,
        payload.diag?.heap_free ?? null,
        JSON.stringify(payload)
    );

    const frameId = frameRes.lastInsertRowid;
    const pumps = Array.isArray(payload.pump)
        ? payload.pump
        : payload.node
            ? [{
                    ...payload.pump,
                    node: payload.node,
                    addr: payload.addr,
                    i: payload.i,
                    unbal_pct: payload.i?.unbal_pct,
                }]
            : payload.pump?.node
                ? [payload.pump]
                : payload.pump && typeof payload.pump === 'object'
                    ? Object.values(payload.pump)
                    : [];

    for (const pump of pumps.filter((item) => item?.node)) {
        upsertDevice.run({
            gw: payload.gw,
            node: pump.node,
            site: payload.site,
            addr: pump.addr ?? null,
            state: pump.state ?? 'unknown',
            ts: payload.ts,
        });

        insertReading.run(
            frameId,
            payload.gw,
            pump.node,
            pump.state ?? 'unknown',
            pump.i?.l1 ?? null,
            pump.i?.l2 ?? null,
            pump.i?.l3 ?? null,
            pump.i?.valid ? 1 : 0,
            pump.unbal_pct ?? null,
            pump.uptime_s ?? null,
            pump.starts ?? null
        );
    }
});

function savePayload(payload) {
    savePayloadTransaction(payload);
}

function getLatestReadings() {
    return db.prepare(`
        SELECT
            dr.node AS id,
            d.site,
            dr.gw,
            dr.state,
            dr.i_l1,
            dr.i_l2,
            dr.i_l3,
            dr.unbal_pct,
            tf.temp_val AS temperature,
            tf.ts AS timestamp
        FROM device_readings dr
        JOIN devices d ON dr.gw = d.gw AND dr.node = d.node
        JOIN telemetry_frames tf ON dr.frame_id = tf.id
        WHERE dr.id IN (
            SELECT MAX(id) FROM device_readings GROUP BY gw, node
        )
        ORDER BY dr.node ASC
    `).all();
}

function getGateways() {
    return db.prepare('SELECT gw, site FROM gateways').all();
}

function getGatewayReadings(gw) {
    return db.prepare(`
        SELECT
            dr.node AS id,
            d.site,
            dr.gw,
            dr.state,
            dr.i_l1,
            dr.i_l2,
            dr.i_l3,
            dr.unbal_pct,
            tf.temp_val AS temperature,
            tf.ts AS timestamp
        FROM device_readings dr
        JOIN devices d ON dr.gw = d.gw AND dr.node = d.node
        JOIN telemetry_frames tf ON dr.frame_id = tf.id
        WHERE dr.gw = ?
            AND dr.id IN (
                SELECT MAX(id)
                FROM device_readings
                WHERE gw = ?
                GROUP BY node
            )
        ORDER BY dr.node ASC
    `).all(gw, gw);
}

function createUser(username, email, password) {
    db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)')
        .run(username, email, password);
    return Promise.resolve();
}

function isUser(username, password) {
    const user = db.prepare(`
        SELECT *
        FROM users
        WHERE username = ? AND password = ?
    `).get(username, password);
    return Promise.resolve(user);
}

function isUsernameExists(username) {
    const user = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    return Promise.resolve(!!user);
}

function updateUserPassword(username, oldPassword, newPassword) {
    const result = db.prepare(
        'UPDATE users SET password = ? WHERE username = ? AND password = ?'
    ).run(newPassword, username, oldPassword);
    return Promise.resolve(result.changes > 0);
}

function updateUsername(oldUsername, newUsername) {
    const result = db.prepare(
        'UPDATE users SET username = ? WHERE username = ?'
    ).run(newUsername, oldUsername);
    return Promise.resolve(result.changes > 0);
}

module.exports = {
    createUser,
    getGatewayReadings,
    getGateways,
    getLatestReadings,
    isUser,
    isUsernameExists,
    savePayload,
    updateUserPassword,
    updateUsername,
};