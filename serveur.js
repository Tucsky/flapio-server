//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* EXPRESS SERVER INITIALISATION
	*/

	// Server requirements

	var io      = require('socket.io'),
		http    = require('http'),
		express = require('express');

	// Define global server properties

		var properties = {
			port: process.env.PORT || 3000,
			host: process.env.HOST || '0.0.0.0',

			sid_index: 'express.sid',

			cookie_parser: express.cookieParser('B68xMzGOxSAm4Io8dP4rbEjcRiwAV49ifSe572Jz7G4Vsp5fcL2ndCuz0rErAV5t'),
			session_store: new express.session.MemoryStore(),

			html_var: {
				cover: {
					name: 'Flap.IO',
					author: 'http://www.xzl.fr'
				}
			}
		}

	// Create express interface

		var app = express();
			app.configure(function () {
				app.use(properties.cookie_parser);
				app.use(express.session({
					store: properties.session_store,
					cookie: { 
						httpOnly: false, 'path': '/'
					},
					key: properties.sid_index
				}));
			});

	// Configture basic server routes

		app.get('/', function (req, res) {
			res.render('index.jade', properties.html_var);
		});

	// Create HTTP server, register socket.io as listener

		server = http.createServer(app);
		io = io.listen(server);

//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* GAME PROCESS
	*/

	function Game() {
		var that = this;

		that.VERSION = "0.2";

		that.BIRDS = {};
		that.COUNT = 0;
		that.SEED = parseInt(rdnb(1,1000000000));
		that.PIPES = [];
		that.BEST = 0;
		that.REWARDS = {
			gold: null,
			silver: null,
			bronze: null
		};
		that.SCORES = {};
		that.MIN = 0;
		that.TOPNB = 0;

		that.MAX_PIPES = 200;
		that.NPL = 2;
		that.COUNT_INTERVAL = 5000;

		that.init = function() {
			that.PIPES = that.getPipes();
			that.MESSAGE = 'Flap.IO Version '+that.VERSION;
			that.listen();

			return that;
		}

		that.Client = function(input) {
			var Client = this;

			if (!input.io) return false;

			if (that.BIRDS[input.id]) return that.BIRDS[input.id].update({io: input.io, online: true});

			Client.io = input.io;
			Client.id = input.id || rdstr(10);
			Client.nickname = input.nickname || 'guest_'+parseInt(rdnb(0, 1000));
			Client.jumps = input.jumps || [];
			Client.online = true;
			Client.scored = false;
			Client.best = 0;
			Client.reward = null;

			Client._ = {
				x: 100,
				y: 200,
				s: 0,
				alive: true,
			};

			Client.jump = function(jumps) {
				if ((jumps && !jumps.length) || !jumps) return false;

				console.log(Client.jumps);
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
						// Si les coordonnées se situes dans un obstacle, le cheat est comfirmé
						if (x > that.PIPES[Client._.s].x && x < that.PIPES[Client._.s].x + 52 && (y < that.PIPES[Client._.s].y || y > that.PIPES[Client._.s].y+that.PIPES[Client._.s].d)) {
							console.log('[CHEAT DETECTED] '+x+' > '+that.PIPES[Client._.s].x+' && '+x+' < '+(that.PIPES[Client._.s].x+52)+' && ('+y+' < '+that.PIPES[Client._.s].y+' || '+y+' > '+that.PIPES[Client._.s].y+that.PIPES[Client._.s].d+')');
							Client.gameOver();
						}
					}

					// Somme après frames
					Client._.x += (JUMP - LAST_JUMP);
					Client._.y = +(Client._.y + ( - 8 + ((0.38 * ((JUMP - LAST_JUMP) / 2 + 1)) /2)) * ((JUMP - LAST_JUMP) / 2)).toFixed(2);
				
					// Nouvelle target
					if (Client._.x > that.PIPES[Client._.s].x + 64) Client._.s++;

				});
				
				// Envois du jump au autres joueurs
				Client.jumps = jumps[0] > Client.jumps[Client.jumps.length-1] ? jumps : Client.jumps.concat(jumps);
				Client.io.broadcast.emit('jump', {id: Client.id, jumps: jumps, score: Client._.s});

				// Reward
				if (Client._.s == that.BEST) Client.reward('gold');
			}

			Client.gameOver = function(data) {
				if (data) {
					// Derniers jumps
					if (data.j && data.j.length) Client.jump(data.j);

					// Score rounder (200 pixels)
					if (Math.abs(data.s - Client._.x) < 200 && data.s > that.PIPES[Client._.s].x+26) Client._.s++;
				}

				// Officiellement mort
				Client._.alive = false;

				// Sauvegarde client
				Client.best = Math.max(Client._.s, Client.best);

				// Sauvegarde serveur
				that.BEST = Math.max(Client.best, that.BEST);

				// Envoi du score aux autres joueurs
				io.sockets.emit('score', {id: Client.id, score: Client._.s, best: that.BEST});

				// Top score
				(that.TOPNB < 20 || Client._.s >= that.MIN) && that.sortTop(Client.id, Client._.s, Client.nickname);
			}

			Client.reset = function() {
				if (Client._.alive) return false;
				console.log('reset');
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

			Client.reward = function(id) {
				if (that.REWARDS[id] == Client.id) return;
				var rotate = {id: Client.id};

				for (var i in that.REWARDS) {
					var id = that.REWARDS[i] || null;
						id == Client.id && (id = null);

					if (rotate.id) that.REWARDS[i] = rotate.id;
					rotate.id = id;
				}

				io.sockets.emit('reward', {rewards: that.REWARDS});
			}

			Client.log = function() {
				Client.io.emit('log', {BIRDS: safe(that.BIRDS), REWARDS: that.REWARDS, PIPES: that.PIPES, COUNT: that.COUNT, SCORES: that.SCORES});
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
			io.set('authorization', function (data, callback) {
				if (data && data.query && data.query.token) {
					data.session = that.BIRDS[data.query.token] && that.BIRDS[data.query.token].online ? rdstr(23) : data.query.token;
					callback(null, true);
				} else {
					data.session = rdstr(23);
					callback(null, true);
				}
			});

			io.on('connection', function (socket) {

				// Récupération/Création du client
				var Bird = new that.Client({id: socket.handshake.session, io: socket});

				console.log('[new socket] SID');
				console.log(socket.handshake.session);

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
					scores: that.SCORES,
					rewards: that.REWARDS
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

					--that.COUNT;

					Bird.online = false;

					socket.broadcast.emit('lead', {id: Bird.id, count: that.COUNT});

				});

			});

			server.listen(properties.port, properties.host, null, function() {
				console.log('Server listening on port %d in %s mode', this.address().port, app.settings.env);
			});
		}

		that.getPipes = function() {
			var seed = that.SEED,
				out = [],
				id = 0, d = 0, o = 0,
				pseudorandom = function() { var x = Math.sin(seed++) * 10000; return x - Math.floor(x); };

			for(var i=0; i<that.MAX_PIPES+that.NPL; i++) {
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

		that.sortTop = function(id, score, nickname) {
			id && score && (that.SCORES[id] = {score: Math.max(((that.SCORES[id] && that.SCORES[id].score) || 0), score), nickname: nickname});

			var object = that.SCORES;
			var array = Object.keys(that.SCORES).sort(function(a, b) {return -(that.SCORES[a].score - that.SCORES[b].score)});

			if (!array.length) return;

			that.SCORES = {};
			that.MIN = object[array[array.length - 1]].score;
			that.TOPNB = array.length;

			console.log('SORTTOPTEMPPOBJ');
			console.log(object);
			for (var i = 0; i < Math.min(array.length, 20); i++) that.SCORES[array[i]] = object[array[i]];
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

	function validate(jumps) {
		var x = 100,
			y = 200;
			
		jumps.forEach(function(jump) {
			for (var ax=1; ax<=1; ax+=2) {

			}
		})
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