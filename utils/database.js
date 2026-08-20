const sqlite3 = require('sqlite3').verbose();
const generateMacHash = require('./macHash').generatemacHash;

const databasePath = './grid-monitor.sqlite.db';

// Save a MAC ID and its hash to the SQLite database
function saveMacIDHash(macID) {
	const hash = generateMacHash(macID);

	const db = new sqlite3.Database(databasePath);

	return new Promise((resolve, reject) => {
		db.run('INSERT INTO macHash (macID, hash) VALUES (?, ?)', [macID, hash], (error) => {
			if (error) {
				db.close(() => reject(error));
				return;
			}

			db.close((error) => (error ? reject(error) : resolve()));
		});
	});
}

function isHashExists(hash) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM macHash WHERE hash = ?', [hash], (error, row) => {
            if (error) {
                db.close(() => reject(error));
                return;
            }

            db.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(!!row); // returns true if a row is found, false otherwise
                }
            });
        });
    });
}

function createUser(username, password, hash) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO users (username, password, macID) SELECT ?, ?, macID FROM macHash WHERE hash = ?',
            [username, password, hash],
            (error) => {
            if (error) {
                db.close(() => reject(error));
                return;
            }

            db.close((error) => (error ? reject(error) : resolve()));
            }
        );
    });
}

function isUser(username, password) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT users.*, macHash.hash
             FROM users
             LEFT JOIN macHash ON macHash.macID = users.macID
             WHERE users.username = ? AND users.password = ?`,
            [username, password],
            (error, row) => {
                if (error) {
                    db.close(() => reject(error));
                    return;
                }

                db.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(row); // row will be undefined if no match is found
                    }
                });
            }
        );
    });
}

function isHashHasUser(hash) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE macID = (SELECT macID FROM macHash WHERE hash = ?)', [hash], (error, row) => {
            if (error) {
                db.close(() => reject(error));
                return;
            }

            db.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(!!row); // returns true if a row is found, false otherwise
                }
            });
        });
    });
}

function isUsernameExists(username) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (error, row) => {
            if (error) {
                db.close(() => reject(error));
                return;
            }

            db.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(!!row); // returns true if a row is found, false otherwise
                }
            });
        });
    });
}

function getUserMacID(username) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.get('SELECT macID FROM users WHERE username = ?', [username], (error, row) => {
            if (error) {
                db.close(() => reject(error));
                return;
            }

            db.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(row ? row.macID : null); // return the macID or null if no user found
                }
            });
        });
    });
}


module.exports = { saveMacIDHash, createUser, isUser, getUserMacID, isHashExists, isHashHasUser, isUsernameExists };