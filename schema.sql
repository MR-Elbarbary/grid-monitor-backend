CREATE TABLE IF NOT EXISTS macHash (
    macID primary key text not null,
    hash text not null unique
);

CREATE TABLE IF NOT EXISTS users (
    id primary key autoincrement,
    username text not null unique,
    password text not null,
    hash Foreign Key (hash) references macHash(hash),
)

CREATE TABLE IF NOT EXISTS device (
    deviceID primary key text not null,
    macID Foreign Key (macID) references macHash(macID),
    deviceName text not null default 'device',
);

CREATE TABLE IF NOT EXISTS deviceData (
    dataID primary key autoincrement,
    deviceID Foreign Key (deviceID) references device(deviceID),
    current float not null,
    voltage float not null,
    temperature float not null,
    timestamp datetime default current_timestamp
);
