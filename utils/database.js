const sqlite3 = require('sqlite3').verbose();

const databasePath = './telemetry.db';

function createUser(username, email, password) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
            [username, email, password],
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
            `SELECT *
            FROM users
            WHERE username = ? AND password = ?`,
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

function updateUserPassword(username, oldPassword, newPassword) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users SET password = ? WHERE username = ? AND password = ?',
            [newPassword, username, oldPassword],
            function (error) {
                if (error) {
                    db.close(() => reject(error));
                    return;
                }

                db.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(this.changes > 0); // returns true if a row was updated, false otherwise
                    }
                });
            }
        );
    });
}

function updateUsername(oldUsername, newUsername) {
    const db = new sqlite3.Database(databasePath);
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users SET username = ? WHERE username = ?',
            [newUsername, oldUsername],
            function (error) {
                if (error) {
                    db.close(() => reject(error));
                    return;
                }

                db.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(this.changes > 0); // returns true if a row was updated, false otherwise
                    }
                });
            }
        );
    });
}

module.exports = { createUser, isUser, isUsernameExists, updateUserPassword, updateUsername };