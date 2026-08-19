const sqlite3 = require('sqlite3').verbose();
const generateMacHash = require('./macHash').generatemacHash;

const databasePath = './grid-monitor.sqlite'

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

function createUser(username, password, hash) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO users (username, password, hash) VALUES (?, ?, ?)', [username, password, hash], (error) => {
            if (error) {
                db.close(() => reject(error));
                return;
            }

            db.close((error) => (error ? reject(error) : resolve()));
        });
    });
}

function isUser(username, password) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (error, row) => {
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
        });
    });
}

function getUserHash(username) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.get('SELECT hash FROM users WHERE username = ?', [username], (error, row) => {
            if (error) {
                db.close(() => reject(error));
                return;
            }

            db.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(row ? row.hash : null); // return the hash or null if no user found
                }
            });
        });
    });
}


module.exports = { saveMacIDHash, createUser, isUser, getUserHash };