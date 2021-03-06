//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* EXPRESS SERVER INITIALISATION
	*/

	// Server requirements

	var io = require('socket.io'),
		http = require('http'),
		express = require('express'),
		mongoose = require('mongoose'),
		crypto = require('crypto'),
		extend = require('node.extend');
		ObjectId = mongoose.Schema.ObjectId;

	// Local configs

		var fs = require('fs'),
			config = fs.existsSync('config.json') ? JSON.parse(fs.readFileSync('config.json', 'UTF-8')) : {};

	// Define global server properties

		var properties = {
			port: process.env.PORT || config.PORT || 3000,
			host: process.env.HOST || config.HOST || '0.0.0.0',

			html_var: {
				cover: {
					name: 'Flap.IO',
					author: 'https://www.kevinrostagni.me'
				}
			},

			mongouri: process.env.MONGOHQ_URL || config.MONGOURI || null,
			salt: process.env.SALT || 'unsecure',

			game: {
				LEVEL: {
					SPACE: process.env.LEVEL_SPACE || 150,
					MIN_DIFFICULTY: process.env.LEVEL_MIN_DIFFICULTY || 175,
					MAX_DIFFICULTY: process.env.LEVEL_MAX_DIFFICULTY || 128,
					DIFFICULTY_FACTOR: process.env.LEVEL_DIFFICULTY_FACTOR || 0.01,

					DYNAMIC_FACTOR: process.env.LEVEL_DYNAMIC_FACTOR || 0.015,
					DYNAMIC_FACTOR_MIN: process.env.LEVEL_DYNAMIC_FACTOR_MIN || 0.2,
					DYNAMIC_FACTOR_MAX: process.env.LEVEL_DYNAMIC_FACTOR_MAX || 0.8,
					DYNAMIC_STRENGTH_FACTOR: process.env.LEVEL_DYNAMIC_STRENGTH_FACTOR || 0.01,
					DYNAMIC_STRENGTH_FACTOR_MIN: process.env.LEVEL_DYNAMIC_STRENGTH_FACTOR_MIN || 0,
					DYNAMIC_STRENGTH_FACTOR_MAX: process.env.LEVEL_DYNAMIC_STRENGTH_FACTOR_MAX || 2,
					DYNAMIC_MARGIN_MIN: process.env.LEVEL_DYNAMIC_MARGIN_MIN || 25,
					DYNAMIC_MARGIN_MAX: process.env.LEVEL_DYNAMIC_MARGIN_MAX || 75,

					MARGIN: process.env.LEVEL_MARGIN || 2,
					WIDTH: process.env.LEVEL_WIDTH || 52
				},
				PHYSICS: {
					XVEL: process.env.PHYSICS_XVEL || 4,
					YVEL: process.env.PHYSICS_YVEL || 0.42,
					FLAP: process.env.PHYSICS_FLAP || -8,
					GRND: process.env.PHYSICS_GRND || 400,
					REST: process.env.PHYSICS_REST || -0.3,
					FRIC: process.env.PHYSICS_FRIC || 0.95,
				},
			},

			mongotry: 0
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
		io.set('log level', 1);

	// Init mongo DB

		function db(reconnect) {
			G && G.console('Mongoose: Connecting ('+(beta ? 'Beta' : 'Default')+')');
			if (reconnect) 
				properties.mongotry++,
				mongoose.disconnect();

			properties.mongodelay = setTimeout(function() {
				mongoose.connect(properties.mongouri);
			}, properties.mongotry * 4000);
		}

		db();

		mongoose.connection.on('connected', function () {
			G && G.console('Mongoose: Connected ('+(beta ? 'Beta' : 'Default')+')');
			clearTimeout(properties.mongodelay);
			properties.mongotry = 0;
		});

		// If the connection throws an error
		mongoose.connection.on('error',function (err) {
			G && G.console('Mongoose: Connection error ('+(beta ? 'Beta' : 'Default')+') '+err);
			db(true);
		});

		// When the connection is disconnected
		mongoose.connection.on('disconnected', function () {
			G && G.console('Mongoose: Disconnected ('+(beta ? 'Beta' : 'Default')+')');
		});

//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* GAME PROCESS
	*/

	function Game() {
		var that = this;

		that.VERSION = "1.1";

		that.BIRDS = [];
		that.SEED = parseInt(rdnb(1,1000000000));
		that.LEVEL = [];
		that.DEBUGLEVEL = [];
		that.BEST = 0;

		that.SCORES = [];
		that.REWARDS = [];
		that.ADMINS = [];
		that.CONSOLE = [];

		that.MAX_LEVEL = 200;
		that.NPL = 2;
		that.ROUND = 0;

		that.DB = {
			SCORES: mongoose.model('scores', {
				_id : String,
				nickname: String,
				score: Number,
				timestamp: Number,
				jumps: String,
				seed: Number,
				ip: String,
				admin: Boolean
			}),
			DAILY: mongoose.model('tournament', {
				_id: ObjectId,
				client: String, 
				nickname: String,
				score: Number,
				timestamp: Number,
				jumps: String,
				seed: Number,
				ip: String
			})
		};

		that.init = function() {
			that.DB.SCORES.find({}, {jumps:0}).sort({"score":-1}).exec(function(err, scoresALL) {
				that.DB.DAILY.find({timestamp: {$gt: new Date().setHours(0, 0, 0)}}, {jumps:0}).sort({"score":-1, "timestamp":-1}).exec(function(err, scoresTODAY) {

					// Update server best
					scoresALL.length && (that.BEST = scoresALL[0].score);

					// Update Scores Array
					that.SCORES = scoresALL;

					// Update rewards
					for (var i = 0; i < 3; i++) scoresTODAY[i] && (that.REWARDS[i] = {id: scoresTODAY[i].client, score: scoresTODAY[i].score});
					
					// Callback
					that.LEVEL = that.setLevel();
					that.MESSAGE = 'FlapIO '+that.VERSION;
					that.listen();

					// Start rounds
					var d = new Date();
					that.ROUND = d.setMinutes(d.getMinutes() + 30);
					setInterval(function() {
						if (+new Date() > that.ROUND) that.resetRound();
					}, 1000);

					// Start day cron
					that.resetDay();

				});
			});

			return that;
		}

		that.resetRound = function() {
			var d = new Date();
			that.ROUND = d.setMinutes(d.getMinutes() + 30);
			that.SEED = parseInt(rdnb(1,1000000000));
			that.LEVEL = that.setLevel();
			io.sockets.emit('round', {round: that.ROUND, seed: that.SEED});
		}

		that.resetDay = function() {
			var d = new Date();
				d.setDate(d.getDate()+1);
			var o = d.setHours(0, 0, 0) - +new Date();
			setTimeout(function() {
				that.console('RESET DAY');
				that.REWARDS = [];
				that.resetDay();
			}, o);
			that.console('START CRON ('+o+' ms)');
		}

		that.getScore = function(id, data) {
			for (var i = 0; i < that.SCORES.length; i++) {
				if (that.SCORES[i]._id == id) return data ? extend(that.SCORES[i], data) : that.SCORES[i];
			}
			return data ? that.SCORES[that.SCORES.push(data)] : {};
		}
		
		that.getClient = function(id) {
			for (var i = 0; i < that.BIRDS.length; i++) {
				if (that.BIRDS[i].id == id) return that.BIRDS[i];
			}
			return;
		}

		that.console = function() {
			var args = Array.prototype.slice.call(arguments);

			// Include datetime
			var dt = +new Date();

			// Admin console (ingame)
			for (var i = 0; i < that.ADMINS.length; i++) {
				var cli = that.getClient(that.ADMINS[i]);
				if (cli && cli.online) cli.io.emit('console', [dt].concat(args));
			}

			// Save arguments
			if (that.CONSOLE.push([dt].concat(args)) > 10) that.CONSOLE.splice(0, 1);

			// Debug console
			console.log.apply(null, ["\033[32m"].concat(args).concat(["\033[39m"]));
		}

		that.Client = function(input) {
			var Client = this;

			if (!input.io) return false;

			// Return existing client object
			if (that.getClient(input.id)) return extend(that.getClient(input.id), {io: input.io, online: true});

			// Or recover user infos from client last score
			if (that.getScore(input.id)) 
				input.nickname = that.getScore(input.id).nickname, 
				input.best = that.getScore(input.id).score,
				input.admin = that.getScore(input.id).admin || null;

			Client.io = input.io;
			Client.id = input.id || rdstr(10);
			Client.nickname = input.nickname || 'bird_'+parseInt(rdnb(0, 10000));
			Client.jumps = input.jumps || [];
			Client.guest = input.guest || false;
			Client.online = true;
			Client.scored = false;
			Client.best = input.best || 0;
			Client.rank = null;
			Client.ip = input.ip || null;
			Client.admin = input.admin || false;

			Client._ = {
				x: 100,
				y: 200,
				j: 0,
				s: 0,
				alive: true,
			};

			Client.getReward = function(score) {
				var output = that.REWARDS.slice();

				output.push(
					{id: Client.id, score: score}
				);

				output = output.sort(function(b, a) { return (+a.score) - (+b.score); });

				that.REWARDS = output.splice(0, 3);

				return that.REWARDS;
			}

			Client.jump = function(jumps) {
				if ((jumps && !jumps.length) || !jumps) return false;

				// Party status (New game, game over, ingame)
				if (jumps[0] <= Client.jumps[Client.jumps.length - 1]) 
					Client.reset();
				else if (Client._.alive == false)
					return;

				var debug = [];

				// Jump is too big
				if (Math.abs(Client.jumps[Client.jumps.length -1] - jumps[0]) > 300) {
					that.console(Client.nickname+': jump length',Math.abs(Client.jumps[Client.jumps.length -1] - jumps[0]), '> 300');
					Client.gameOver();
				}

				jumps.forEach(function(JUMP, INDEX) {

					// Definition du point de référence
					LAST_JUMP = INDEX < 1 ? Client.jumps[Client.jumps.length - 1] : jumps[INDEX - 1];
					if (!LAST_JUMP) return;

					// Simulation du mouvement
					for (var FRAME = 1; FRAME <= (JUMP - LAST_JUMP)/properties.game.PHYSICS.XVEL; FRAME += 2) {

						// Nouveau point Y en fonction de la velocité de départ (-8), la gravité (0.38) et la distance par rapport au point de référence
						y = +(Client._.y + (properties.game.PHYSICS.FLAP + ((properties.game.PHYSICS.YVEL * (FRAME + 1)) / 2)) * FRAME).toFixed(2);

						// Nouveau point X (augmentation constante: 1f = +2x)
						x = Client._.x + FRAME * properties.game.PHYSICS.XVEL;

						if (beta) {
							if (!that.LEVEL[Client._.s].isDynamic && x + 2 > that.LEVEL[Client._.s].x && x < that.LEVEL[Client._.s].x + properties.game.LEVEL.WIDTH - 2)
								debug.push({type: 'pipe', x: x, top: that.LEVEL[Client._.s].y, bottom: that.LEVEL[Client._.s].y+that.LEVEL[Client._.s].d});

							debug.push({type: 'path', x: x, y: y});
						}

						// Si les coordonnées se situes dans un obstacle, le cheat est confirmé
						if (!that.LEVEL[Client._.s].isDynamic && x > that.LEVEL[Client._.s].x && x < that.LEVEL[Client._.s].x + properties.game.LEVEL.WIDTH && (y < that.LEVEL[Client._.s].y || y > that.LEVEL[Client._.s].y+that.LEVEL[Client._.s].d)) {
							that.console(Client.nickname+': cheat detected','ID:'+Client._.s+', D:false, pipeX:'+that.LEVEL[Client._.s].x+', pipeY:'+that.LEVEL[Client._.s].y+', birdX:'+x+', birdY:'+y);
							Client.gameOver();
						} else if (y > properties.game.PHYSICS.GRND) {
							that.console(Client.nickname+': y > physics.ground',y);
							Client.gameOver();
						}
					}

					// Somme après frames
					Client._.x += (JUMP - LAST_JUMP);
					Client._.y = +(Client._.y + (properties.game.PHYSICS.FLAP + ((properties.game.PHYSICS.YVEL * ((JUMP - LAST_JUMP) / properties.game.PHYSICS.XVEL + 1)) /2)) * ((JUMP - LAST_JUMP) / properties.game.PHYSICS.XVEL)).toFixed(2);
					Client._.j = JUMP;
				
					// Nouvelle target
					if (Client._.x > that.LEVEL[Client._.s].x + 64) Client._.s++;

				});

				if (beta)
					Client.io.emit('debug', debug);
				
				// Envois du jump au autres joueurs
				Client.jumps = Client.jumps.concat(jumps);
				Client.io.broadcast.emit('jump', {id: Client.id, jumps: jumps, score: Client._.alive ? Client._.s : null});
			}

			Client.gameOver = function(data) {
				if (!Client._.alive) return;

				if (data) {
					that.console(Client.nickname+': client gameover');

					// Derniers jumps
					if (data.j && data.j.length) Client.jump(data.j);

					// Score rounder (200 pixels)
					if (Math.abs(data.s - Client._.x) < 200 && data.s > that.LEVEL[Client._.s].x+26) Client._.s++;
				} else {
					that.console(Client.nickname+': server gameover');
				}

				// Officiellement mort
				Client._.alive = false;

				// Updates best score (client & server)
				Client.best = Math.max(Client._.s, Client.best);
				that.BEST = Math.max(Client.best, that.BEST);

				// Envoi du score aux autres joueurs
				io.sockets.emit('score', {id: Client.id, score: Client._.s, best: that.BEST, rewards: Client.getReward(Client._.s)});

				// Regenerate Score Object
				if (Client._.s) {

					that.DB.SCORES.count({score: {$gt:Client._.s}}, function(err, alltime) {
						if (err) 
							that.console(Client.nickname+': upsert/mongo error');
						else
							that.DB.DAILY.count({score: {$gt:Client._.s}, timestamp: {$gt: new Date().setHours(0, 0, 0)}}, function(err, daily) {
								if (err) 
								that.console(Client.nickname+': upsert/mongo error');
								else {
									Client.io.emit('rank', {id: Client.id, rank: {alltime: alltime + 1, daily: daily + 1}});
								}
							});
					});

					var upsert = {
						nickname: Client.nickname, 
						score: Client._.s, 
						timestamp: +new Date(), 
						jumps: Client.jumps, 
						seed: that.SEED,
						ip: Client.ip
					}

					that.DB.DAILY.findOne({client: Client.id, timestamp: {$gt: new Date().setHours(0, 0, 0)}}).exec(function(err, player) {
						if (err) 
							that.console(Client.nickname+': upsert/mongo error');
						if (!player || Client._.s >= player.score) {
							that.console(Client.nickname+': new daily score ('+Client._.s+')');
							that.DB.DAILY.update({ client: Client.id, timestamp: {$gt: new Date().setHours(0, 0, 0)}}, upsert, {upsert: true}, function(err, res) {});
						}
					});

					if (that.getScore(Client.id).score >= Client._.s) return;

					that.getScore(Client.id, {_id: Client.id, nickname: Client.nickname, score: Client._.s });
					
					that.DB.SCORES.update({ _id: Client.id}, upsert, {upsert: true}, function(err, res) {
						if (err) 
							that.console(Client.nickname+': upsert/mongo error');
						else {
							that.console(Client.nickname+': new server score ('+Client._.s+')');
							extend(that.getClient(Client.id), {nickname: Client.nickname, score: Client._.s});
						}
					});
				}
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
				if (!nickname || nickname.replace(/[^A-Za-z0-9!_-]/g, '').length < 3) return false;

				Client.nickname = nickname.replace(/[^A-Za-z0-9!_-]/g, '');

				io.sockets.emit('nickname', {id: Client.id, nickname: Client.nickname});
			}

			Client.getGhost = function(id) {
				that.DB.SCORES.findOne({_id: id}).exec(function(err, ghost) {
					Client.io.emit('ghost', ghost);
				});
			}

			Client.getLeaderboard = function(data) {
				var page = typeof data.page !== 'undefined' ? data.page : 0,
					sort = {},
					by = data.by || -1,
					nickname = data.nickname ? new RegExp(data.nickname, 'i') : null,
					collection = data.collection || 'd',
					daily = data.daily || 0;
					current = new Date(),
					search = {};

					current.setDate(current.getDate() + daily);

					sort[data.order || 'score'] = data.by || -1;
					sort.score == -1 && (sort.timestamp = -1);

				switch (collection) {
					case 'd':
						collection = 'DAILY';
						search.timestamp = {$gt: current.setHours(0, 0, 0), $lt: current.setHours(23, 59, 59)};
						break;
					case 'a':
						collection = 'SCORES';
						break;
				}

				if (nickname) search.nickname = nickname;

				that.DB[collection].count(search, function(err, count){
					if (page > Math.floor(count/25))
						return Client.io.emit('message', {options: {class: 'warning'}, text: 'No more high scores'});

					that.DB[collection].find(search, {jumps:0}).sort(sort).skip(25*page).limit(25).exec(function(err, scores) {
						if (err) that.console(Client.nickname+': upsert/mongo error');
						Client.io.emit('leaderboard', {scores: scores, count: count});
					});
				})
			}

			Client.log = function() {
				Client.io.emit('log', {TIME: +new Date(), DEBUGLEVEL: that.DEBUGLEVEL, BIRDS: safe(that.BIRDS), REWARDS: that.REWARDS, LEVEL: that.LEVEL, COUNT: io.sockets.clients().length, SCORES: that.SCORES});
			}

			Client.disconnect = function() {
				Client.io.disconnect();
			}

			that.BIRDS.push(Client);

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
				var token = data.query.token ? encrypt(data.query.token).substr(0, 16) : null;

				data.remoteAdrr = data.address.address+':'+data.address.port;

				if (data && data.query && token && !(that.getClient(token) && that.getClient(token).online)) {

					// Le joueur a transmit son token PHP, il peut récupérer son compte
					data.session = data.query.token;
					callback(null, true);

				} else {

					// Le joueur n'a pas transféré de token PHP, génération d'un identifiant de joueur unique et éphémère.
					data.session = rdstr(14);
					data.guest = true;
					while (that.getClient(data.session)) data.session = rdstr(14);
					callback(null, true);

				}
			});

			io.on('connection', function (socket) {

				// IP
				var ip = socket.handshake.remoteAdrr;

				// Encryption de l'id, ainsi l'utilisateur
				var uid = encrypt(socket.handshake.session).substr(0, 16);

				// Récupération/Création du client
				var Bird = new that.Client({id: uid, io: socket, guest: (socket.handshake.guest || false), ip: ip});

				// Logging
				that.console(ip+' ('+Bird.nickname+'#'+Bird.id+') join the game');

				// Admin ou pas admin
				if (Bird.admin && that.ADMINS.indexOf(Bird.id) == -1) that.ADMINS.push(Bird.id);

				// Incrementation du counter
				var count = io.sockets.clients().length;

				// Callback auprès de l'auteur de connexion
				socket.emit('init', {
					game: properties.game,
					bird: {id: Bird.id, nickname: Bird.nickname, best: Bird.best}, 
					players: safe(that.BIRDS),
					seed: that.SEED,
					count: count,
					message: that.MESSAGE,
					best: that.BEST,
					guest: Bird.guest,
					pages: Math.floor(that.SCORES.length / 25),
					round: that.ROUND - +new Date(),
					rewards: that.REWARDS,
					console: Bird.admin ? that.CONSOLE : []
				});

				// Transmission des données aux autres clients
				socket.broadcast.emit('new', {id: Bird.id, nickname: Bird.nickname, count: count, rewards: that.REWARDS});

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
						case 'ghost':
							Bird.getGhost(data.dt);
							break;
						case 'leaderboard':
							Bird.getLeaderboard(data.dt);
							break;
						case 'nickname':
							Bird.rename(data.dt);
							break;
						default:
							that.console('Unknown command ('+data.fn+')');
						}

				// Commandes declenchés par l'administrateur
				}).on('admin_command', function(data) {
					if (!Bird.admin) return;

					// Fonctions utilisateur
					switch (data.fn) {
						case 'refresh':
							socket.emit('refresh', {rewards: that.REWARDS, online: safe(that.BIRDS)});
							break;
						case 'kick':
							if (!data.dt || !data.dt.id || !(player = that.getClient(data.dt.id))) break;
							that.console('/kick '+player.nickname);
							if (player) player.disconnect();
							break;
						case 'endround':
							that.console('/endround');
							that.resetRound();
							break;
						case 'reward':
							if (!data.dt || !data.dt.id || isNaN(data.dt.rank) || !(player = that.getClient(data.dt.id))) break;
							that.console('/reward '+player.nickname+' '+data.dt.rank);
							player.getReward(0, (data.dt.rank - 1));
							break;
						default:
							that.console('Unknown command ('+data.fn+')');
						}

				// Deconnexion du client
				}).on('disconnect', function () {
					if (Bird.online == false) return;

					Bird.online = false;

					if (that.ADMINS.indexOf(Bird.id) != -1) that.ADMINS.splice(that.ADMINS.indexOf(Bird.id), 1);
					socket.broadcast.emit('lead', {id: Bird.id, count: io.sockets.clients().length - 1});

					that.console(Bird.nickname+' disconnected from server');

				}).on('lead', function () {
					if (Bird.online == false) return;

					Bird.online = false;

					if (that.ADMINS.indexOf(Bird.id) != -1) that.ADMINS.splice(that.ADMINS.indexOf(Bird.id), 1);
					socket.broadcast.emit('lead', {id: Bird.id, count: io.sockets.clients().length - 1});

				});

			});

			server.listen(properties.port, function() {
				that.console('Server v'+that.VERSION+' listening on port '+properties.port+' ('+properties.host+') in '+app.settings.env+' mode');
			});
		}

		that.setLevel = function() {
			var seed = that.SEED,
				out = [],
				id = 0, d = 0, o = 0,
				pseudorandom = function(offset) { var x = +Math.sin(offset ? seed + offset : seed++).toFixed(8) * 10000; return x - Math.floor(x); };
				var debug = [];
			for (var i=0; i<that.MAX_LEVEL+that.NPL; i++) {
				var heightFactor = pseudorandom(),
					heightFactorOffset = pseudorandom(10000);
				if (i>=that.NPL) {
					id = i - that.NPL;
					d = Math.max(Math.min(properties.game.LEVEL.MIN_DIFFICULTY - ((properties.game.LEVEL.MIN_DIFFICULTY * properties.game.LEVEL.DIFFICULTY_FACTOR) * id), 300), properties.game.LEVEL.MAX_DIFFICULTY);
					o = +(heightFactor * (properties.game.PHYSICS.GRND - d - (properties.game.LEVEL.WIDTH * 2)) + properties.game.LEVEL.WIDTH).toFixed(2);

					out.push({y: o, x:i * (properties.game.LEVEL.SPACE + properties.game.LEVEL.WIDTH), d:d, isDynamic: heightFactorOffset < Math.max(Math.min(id * properties.game.LEVEL.DYNAMIC_FACTOR / 2, properties.game.LEVEL.DYNAMIC_FACTOR_MAX), properties.game.LEVEL.DYNAMIC_FACTOR_MIN)}); 
				}
			}
			that.DEBUGLEVEL = debug;
			return out;
		}
	}

//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* RESET.JS
	*/

	function safe(data) {
		var output = [];

		function get(socket) {
			var safe = {
				id: socket.id ? socket.id : null,
				nickname: typeof socket.nickname != 'undefined' ? socket.nickname : null,
				online: typeof socket.online != 'undefined' ? socket.online : null,
				guest: socket.guest || false,
				_: socket._.alive ? socket._ : null,
			};
			return safe;
		}

		if (data.constructor === G.Client)
			output = get(data);
		else
			for (var i = 0; i < data.length; i++) {
				if (data[i].online)
					output.push(get(data[i]));
			}

		return output;
	}

	function rdstr(l,c) {
		if (!c) { c = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'; }
	    for (var i = l, r = ''; i > 0; --i) r += c[Math.round(Math.random() * (c.length - 1))];
	    return r;
	}

	function rdnb(min, max) { return parseFloat((Math.random() * (min - max) + max)); }


	function encrypt(text) {
		var cipher = crypto.createCipher('aes-256-cbc', properties.salt)
		var crypted = cipher.update(text,'utf8','hex')
		crypted += cipher.final('hex');
		return crypted;
	}


//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

	/* STARTUP
	*/

	var G = new Game().init();
