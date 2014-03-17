//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* EXPRESS SERVER INITIALISATION
	*/

	// Server requirements

	var io      = require('socket.io'),
		http    = require('http'),
		express = require('express');
		mongoose = require('mongoose');
		crypto = require('crypto');
		config = require('./config').ext;

	// Define global server properties

		var properties = {
			port: process.env.PORT || config.PORT || 3000,
			host: process.env.HOST || config.HOST || '0.0.0.0',

			html_var: {
				cover: {
					name: 'Flap.IO',
					author: 'http://www.xzl.fr'
				}
			},

			mongouri: process.env.MONGOHQ_URL || config.MONGOURI || null
		},

		beta = typeof process.env.MONGOHQ_URL === 'undefined';

	// Create express interface

		var app = express();

	// Configture basic server routes

		app.get('/', function (req, res) {
			res.render('index.jade', properties.html_var);
		});

	// Create HTTP server, register socket.io as listener

		server = http.createServer(app);
		io = io.listen(server);

	// Init mongo DB

		mongoose.connect(properties.mongouri, function(err) {
			if (err)
				throw err;
			else
				console.log('Mongodb connection initialized');
		});

//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* GAME PROCESS
	*/

	function Game() {
		var that = this;

		that.VERSION = "0.22";

		that.BIRDS = {};
		that.COUNT = 0;
		that.SEED = parseInt(rdnb(1,1000000000));
		that.LEVEL = [];
		that.BEST = 0;

		that.SCORES = {};
		that.COUNT_SCORE = 0;
		that.MINIMUM_SCORE = 0;

		that.MAX_LEVEL = 200;
		that.NPL = 2;
		that.COUNT_INTERVAL = 5000;

		that.DB = {
			SCORES: mongoose.model((beta ? 'scores_beta' : 'scores'), {
				_id : String,
				nickname: String,
				score: Number,
			})
		};

		that.init = function() {
			that.sync.down.scores(function() {

				that.LEVEL = that.setLevel();
				that.MESSAGE = 'Flap.IO Version '+that.VERSION;
				that.listen();

			});

			return that;
		}

		that.Client = function(input) {
			var Client = this;

			if (!input.io) return false;

			if (that.BIRDS[input.id]) return that.BIRDS[input.id].update({io: input.io, online: true});
			if (that.SCORES[input.id]) input.nickname = that.SCORES[input.id].nickname, input.best = that.SCORES[input.id].score;

			Client.io = input.io;
			Client.id = input.id || rdstr(10);
			Client.ip = input.ip || 'unknown';
			Client.nickname = input.nickname || 'bird_'+parseInt(rdnb(0, 10000));
			Client.jumps = input.jumps || [];
			Client.guest = input.guest || false;
			Client.online = true;
			Client.scored = false;
			Client.best = input.best || 0;
			Client.rank = null;

			Client._ = {
				x: 100,
				y: 200,
				j: 0,
				s: 0,
				alive: true,
			};

			Client.jump = function(jumps) {
				if ((jumps && !jumps.length) || !jumps) return false;

				// Party status (New game, game over, ingame)
				if (jumps[0] <= Client.jumps[Client.jumps.length - 1]) 
					Client.reset();
				else if (Client._.alive == false)
					return;

				// Jump is too big
				if (Math.abs(Client.jumps[Client.jumps.length -1] - jumps[0]) > 200) Client.gameOver();

				jumps.forEach(function(JUMP, INDEX) {

					// Definition du point de référence
					LAST_JUMP = INDEX < 1 ? Client.jumps[Client.jumps.length - 1] : jumps[INDEX - 1];
					if (!LAST_JUMP) return;

					// Simulation du mouvement
					for (var FRAME = 1; FRAME <= (JUMP - LAST_JUMP)/2; FRAME += 5) {

						// Nouveau point Y en fonction de la velocité de départ (-8), la gravité (0.38) et la distance par rapport au point de référence
						y = +(Client._.y + (-8 + ((0.38 * (FRAME + 1)) / 2)) * FRAME).toFixed(2);

						// Nouveau point X (augmentation constante: 1f = +2x)
						x = Client._.x + FRAME * 2;

						// Si les coordonnées se situes dans un obstacle, le cheat est confirmé
						if (x > that.LEVEL[Client._.s].x && x < that.LEVEL[Client._.s].x + 52 && (y < that.LEVEL[Client._.s].y || y > that.LEVEL[Client._.s].y+that.LEVEL[Client._.s].d)) {
							Client.gameOver();
						}
					}

					// Somme après frames
					Client._.x += (JUMP - LAST_JUMP);
					Client._.y = +(Client._.y + ( - 8 + ((0.38 * ((JUMP - LAST_JUMP) / 2 + 1)) /2)) * ((JUMP - LAST_JUMP) / 2)).toFixed(2);
					Client._.j = JUMP;
				
					// Nouvelle target
					if (Client._.x > that.LEVEL[Client._.s].x + 64) Client._.s++;

				});
				
				// Envois du jump au autres joueurs
				Client.jumps = jumps[0] > Client.jumps[Client.jumps.length-1] ? jumps : Client.jumps.concat(jumps);
				Client.io.broadcast.emit('jump', {id: Client.id, jumps: jumps, score: Client._.s});
			}

			Client.gameOver = function(data) {
				if (data) {
					// Derniers jumps
					if (data.j && data.j.length) Client.jump(data.j);

					// Score rounder (200 pixels)
					if (Math.abs(data.s - Client._.x) < 200 && data.s > that.LEVEL[Client._.s].x+26) Client._.s++;
				}

				// Officiellement mort
				Client._.alive = false;

				// Updates best score (client & server)
				Client.best = Math.max(Client._.s, Client.best);
				that.BEST = Math.max(Client.best, that.BEST);

				// Envoi du score aux autres joueurs
				io.sockets.emit('score', {id: Client.id, score: Client._.s, best: that.BEST});

				// Regenerate Score Object
				that.setRank(Client.id, Client._.s, Client.nickname, Client.ip);
			}

			Client.reset = function() {
				if (Client._.alive) return false;
				Client._ = {
					x: 100,
					y: 200,
					alive: true,
					s: 0
				}
				Client.jumps = [];
			}

			Client.rename = function(nickname) {
				if (!nickname || (nickname && nickname.length < 3)) return false;

				Client.nickname = nickname.replace(/\W/g,'');

				io.sockets.emit('nickname', {id: Client.id, nickname: Client.nickname});
			}

			Client.log = function() {
				Client.io.emit('log', {BIRDS: safe(that.BIRDS), REWARDS: that.REWARDS, LEVEL: that.LEVEL, COUNT: that.COUNT, SCORES: that.SCORES});
			}

			Client.update = function(input) {
				Client.id = input.id || Client.id;
				Client.jumps = input.jumps || Client.jumps;
				Client.nickname = input.nickname || Client.nickname;
				Client.io = input.io || Client.io;
				Client.online = input.online || Client.online;

				return Client;
			}

			that.BIRDS[Client.id] = Client;

			return Client;
		}

		that.listen = function() {
			if (!beta) {
				io.configure(function () { 
					io.set("transports", ["xhr-polling"]); 
					io.set("polling duration", 10); 
				});
			}

			io.set('authorization', function (data, callback) {
				var token = data.query.token ? that.secr.encrypt(data.query.token).substr(0, 16) : null;

				if (data && data.query && token && !(that.BIRDS[token] && that.BIRDS[token].online)) {

					// Le joueur a transmit son token PHP, il peut récupérer son compte
					data.session = data.query.token;
					callback(null, true);

				} else {

					// Le joueur n'a pas transféré de token PHP, génération d'un identifiant de joueur unique et éphémère.
					data.session = rdstr(14);
					data.guest = true;
					while (that.BIRDS[data.session]) data.session = rdstr(14);
					callback(null, true);

				}
			});

			io.on('connection', function (socket) {

				// Encryption de l'id, ainsi l'utilisateur
				var uid = that.secr.encrypt(socket.handshake.session).substr(0, 16);
				var ip = socket.handshake.address.address + ":" + socket.handshake.address.port;

				// Récupération/Création du client
				var Bird = new that.Client({id: uid, io: socket, guest: (socket.handshake.guest || false), ip: ip});

				// Incrementation du counter
				++that.COUNT;

				// Callback auprès de l'auteur de connexion
				socket.emit('init', {
					bird: {id: Bird.id, nickname: Bird.nickname, best: Bird.best}, 
					players: safe(that.BIRDS),
					seed: that.SEED,
					count: that.COUNT,
					message: that.MESSAGE,
					best: that.BEST,
					scores: that.SCORES
				});

				// Transmission des données aux autres clients
				socket.broadcast.emit('new', {id: Bird.id, nickname: Bird.nickname, count: that.COUNT});

				// Commandes declenchés par l'utilisateur
				socket.on('user_command', function(data) {

					// Fonctions utilisateur
					switch (data.fn) {
						case 'jump':
							Bird.jump(data.dt);
							break;
						case 'gameover':
							Bird.gameOver(data.dt);
							break;
						case 'log':
							Bird.log();
							break;
						case 'nickname':
							Bird.rename(data.dt);
							break;
						default:
							console.log('unknown command');
						}

				// Deconnexion du client
				}).on('disconnect', function () {
					if (Bird.online == false) return;

					--that.COUNT;

					Bird.online = false;

					socket.broadcast.emit('lead', {id: Bird.id, count: that.COUNT});

				}).on('lead', function () {
					if (Bird.online == false) return;

					--that.COUNT;

					Bird.online = false;

					socket.broadcast.emit('lead', {id: Bird.id, count: that.COUNT});

				});

			});

			server.listen(properties.port, function() {
				console.log('Server v'+that.VERSION+' listening on port '+properties.port+' ('+properties.host+') in '+app.settings.env+' mode');
			});
		}

		that.setLevel = function() {
			var seed = that.SEED,
				out = [],
				id = 0, d = 0, o = 0,
				pseudorandom = function() { var x = Math.sin(seed++) * 10000; return x - Math.floor(x); };

			for (var i=0; i<that.MAX_LEVEL+that.NPL; i++) {
				if (i>=that.NPL) {
					id = i - that.NPL;
					d = Math.max(Math.min(200 - ((200 * 0.01) * id), 300), 125);
					o = +(pseudorandom() * (400 - d - 100) + 50).toFixed(2);

					out.push({y: o, x:i * (150 + 52), d:d}); 
				} else {
					pseudorandom();
				}
			}
			return out;
		}

		that.setRank = function(id, score, nickname, ip) {
			if (!id || !score || (that.COUNT_SCORE >= 16 && that.MINIMUM_SCORE > score)) return;

			// Upsert score by ID (local)
			that.SCORES[id] = {score: Math.max(((that.SCORES[id] && that.SCORES[id].score) || 0), score), nickname: nickname, ip: ip};

			// Upsert server score by ID
			that.sync.up.scores(id, that.SCORES[id]);

			var object = that.SCORES,
				array = Object.keys(that.SCORES).sort(function(a, b) {return -(that.SCORES[a].score - that.SCORES[b].score)});

			// Clear old scores
			that.SCORES = {};

			// Update new Score Object metadata
			that.MINIMUM_SCORE = object[array[array.length - 1]].score;
			that.COUNT_SCORE = array.length;

			for (var i = 0; i < Math.min(array.length, 16); i++) {

				// Update Score Object
				that.SCORES[array[i]] = object[array[i]];

			}
		}

		that.sync = {
			up: {
				scores: function(id, data) {
					that.DB.SCORES.update({ _id: id }, data, {upsert: true}, function(err) {
						//if (err) throw err;
					});
				},
			},
			down: {
				scores: function(callback) {
					that.DB.SCORES.find().sort({"score":-1}).limit(16).exec(function(err, scores) {
						//if (err) throw err;

						// Update server best
						scores.length && (that.BEST = scores[0].score);

						// Update Score Object
						scores.forEach(function(score, i) {
							that.SCORES[score._id] = {score: score.score, nickname: score.nickname};
						});

						if (typeof callback === 'function') callback();
					});
				}
			}
		}

		that.secr = {
			encrypt: function(text) {
				var cipher = crypto.createCipher('aes-256-cbc','d6F3Efeq')
				var crypted = cipher.update(text,'utf8','hex')
				crypted += cipher.final('hex');
				return crypted;
			}
		}

	}

//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* RESET.JS
	*/

	function safe(data) {
		var output = {};

		function get(socket) {
			var safe = {
				id: socket.id ? socket.id : null,
				nickname: typeof socket.nickname != 'undefined' ? socket.nickname : null,
				jumps: typeof socket.jumps != 'undefined' ? socket.jumps : null,
				online: typeof socket.online != 'undefined' ? socket.online : null,
				guest: socket.guest || false,
				rank: socket.rank || null,
				_: socket._.alive ? socket._ : null,
			};
			return safe;
		}

		if (data.constructor === G.Client)
			output = get(data);
		else
			for (i in data) {
				if (data[i].online)
					output[i] = get(data[i]);
			}

		return output;
	}

	function rdstr(l,c) {
		if (!c) { c = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'; }
	    for (var i = l, r = ''; i > 0; --i) r += c[Math.round(Math.random() * (c.length - 1))];
	    return r;
	}

	function rdnb(min, max) { return parseFloat((Math.random() * (min - max) + max)); }

//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* STARTUP
	*/

	var G = new Game().init();
