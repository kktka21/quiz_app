import { getRandomQuestions } from './questions.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
	cors: {
		origin: 'http://localhost:5173',
		credentials: true
	}
});

app.use(cors());
app.use(express.json());

// ==================== БАЗА ДАННЫХ ====================
const USERS_FILE = 'users.json';
const users = new Map();

// Загрузка пользователей из файла
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            const usersArray = JSON.parse(data);
            usersArray.forEach(user => {
                users.set(user.id, user);
            });
            console.log(`✅ Загружено ${users.size} пользователей`);
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
    }
}

// Сохранение пользователей в файл
function saveUsers() {
    try {
        const usersArray = Array.from(users.values());
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersArray, null, 2));
    } catch (error) {
        console.error('Ошибка сохранения пользователей:', error);
    }
}

// Загружаем пользователей при старте
loadUsers();

const rooms = new Map();

// Функция генерации кода комнаты
const generateRoomCode = () => {
	return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// Функция подсчета очков
const calculatePoints = (isCorrect, timeLeft, maxTime) => {
	if (!isCorrect) return 0;
	const speedBonus = (timeLeft / maxTime) * 50;
	return Math.round(100 + speedBonus);
};

// ==================== REST API ====================

// Middleware для проверки токена
const authMiddleware = (req, res, next) => {
	const token = req.headers.authorization?.split(' ')[1];
	if (!token) return res.status(401).json({ error: 'Нет токена' });

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		req.userId = decoded.userId;
		next();
	} catch {
		res.status(401).json({ error: 'Неверный токен' });
	}
};

// Регистрация
app.post('/api/auth/register', async (req, res) => {
	try {
		const { email, password, nickname } = req.body;

		// ========== ВАЛИДАЦИЯ ==========
		// Проверка email
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!email || !emailRegex.test(email)) {
			return res.status(400).json({ error: 'Введите корректный email (пример: name@domain.com)' });
		}

		// Проверка длины пароля
		if (!password || password.length < 6) {
			return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
		}

		// Проверка никнейма (если указан)
		if (nickname && (nickname.length < 2 || nickname.length > 20)) {
			return res.status(400).json({ error: 'Никнейм должен быть от 2 до 20 символов' });
		}

		// Проверка на существующего пользователя
		const existing = Array.from(users.values()).find(u => u.email === email);
		if (existing) return res.status(400).json({ error: 'Пользователь с таким email уже существует' });

		const hashedPassword = await bcrypt.hash(password, 10);
		const userId = uuidv4();
		const user = {
			id: userId,
			nickname: nickname || email.split('@')[0],
			email,
			password: hashedPassword,
			avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
			createdAt: new Date(),
			totalScore: 0,
			gamesPlayed: 0,
			wins: 0,
			correctAnswers: 0
		};

		users.set(userId, user);
		saveUsers();
		const token = jwt.sign({ userId }, process.env.JWT_SECRET);

		const { password: _, ...userWithoutPassword } = user;
		res.json({ token, user: userWithoutPassword });
	} catch (error) {
		console.error('Register error:', error);
		res.status(500).json({ error: 'Ошибка регистрации' });
	}
});

// Логин
app.post('/api/auth/login', async (req, res) => {
	try {
		const { email, password } = req.body;
		const user = Array.from(users.values()).find(u => u.email === email);

		if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });

		const valid = await bcrypt.compare(password, user.password);
		if (!valid) return res.status(401).json({ error: 'Неверный email или пароль' });

		const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
		const { password: _, ...userWithoutPassword } = user;
		res.json({ token, user: userWithoutPassword });
	} catch (error) {
		res.status(500).json({ error: 'Ошибка входа' });
	}
});

// Лидерборд
app.get('/api/leaderboard', (req, res) => {
	const leaderboard = Array.from(users.values())
		.sort((a, b) => b.totalScore - a.totalScore)
		.slice(0, 100)
		.map((user, index) => ({
			rank: index + 1,
			id: user.id,
			nickname: user.nickname,
			avatarUrl: user.avatarUrl,
			totalScore: user.totalScore,
			wins: user.wins,
			accuracy: user.gamesPlayed > 0 ? (user.correctAnswers / (user.gamesPlayed * 10)) * 100 : 0
		}));
	res.json(leaderboard);
});

// Список комнат
app.get('/api/rooms', (req, res) => {
	const publicRooms = Array.from(rooms.values())
		.filter(r => r.status === 'waiting')
		.map(r => ({
			id: r.id,
			name: r.name,
			code: r.code,
			playersCount: r.players.size,
			maxPlayers: r.settings.maxPlayers,
			status: r.status
		}));
	res.json(publicRooms);
});

// Создать комнату
app.post('/api/rooms/create', authMiddleware, (req, res) => {
	const { name, maxPlayers, questionsCount, timeLimit, category, hostId } = req.body;

	const room = {
		id: uuidv4(),
		code: generateRoomCode(),
		name: name || 'Новая комната',
		hostId,
		status: 'waiting',
		settings: {
			maxPlayers: maxPlayers || 4,
			questionsCount: questionsCount || 10,
			timeLimit: timeLimit || 20,
			category: category || 'Микс'
		},
		players: new Map(),
		scores: new Map(),
		currentQuestion: 0,
		answers: new Map()
	};

	const host = users.get(hostId);
	if (host) {
		room.players.set(hostId, {
			userId: hostId,
			nickname: host.nickname,
			avatarUrl: host.avatarUrl,
			isReady: true,
			score: 0
		});
	}

	rooms.set(room.id, room);
	res.json({ roomId: room.id, code: room.code });
});

// Присоединиться к комнате
app.post('/api/rooms/join', authMiddleware, (req, res) => {
	const { code, userId, roomId } = req.body;
	
	console.log('📥 Присоединение:', { code, userId, roomId });
	
	let room;
	
	if (roomId) {
		room = rooms.get(roomId);
	} else if (code && typeof code === 'string') {
		const searchCode = code.toUpperCase();
		room = Array.from(rooms.values()).find(r => r.code === searchCode);
	} else {
		return res.status(400).json({ error: 'Не указан код или ID комнаты' });
	}

	if (!room) {
		console.log('❌ Комната не найдена');
		return res.status(404).json({ error: 'Комната не найдена' });
	}
	
	if (room.players.size >= room.settings.maxPlayers) {
		return res.status(400).json({ error: 'Комната заполнена' });
	}

	const user = users.get(userId);
	if (!user) {
		return res.status(404).json({ error: 'Пользователь не найден' });
	}

	if (room.players.has(userId)) {
		return res.json({ roomId: room.id });
	}

	room.players.set(userId, {
		userId,
		nickname: user.nickname,
		avatarUrl: user.avatarUrl,
		isReady: false,
		score: 0
	});

	console.log(`✅ ${user.nickname} присоединился к комнате ${room.name}`);
	res.json({ roomId: room.id });
});

// ==================== WEBSOCKET ====================

io.use((socket, next) => {
	const token = socket.handshake.auth.token;
	if (!token) return next(new Error('Authentication error'));

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		socket.userId = decoded.userId;
		next();
	} catch {
		next(new Error('Invalid token'));
	}
});

io.on('connection', (socket) => {
	console.log('🔌 Пользователь подключился:', socket.userId);

	let currentRoomId = null;

	socket.on('join_room', ({ roomId }) => {
		console.log(`📡 Пользователь ${socket.userId} присоединяется к комнате ${roomId}`);
		socket.join(roomId);
		currentRoomId = roomId;

		const room = rooms.get(roomId);
		if (room) {
			const players = Array.from(room.players.values()).map(p => ({
				userId: p.userId,
				nickname: p.nickname,
				avatarUrl: p.avatarUrl,
				isReady: p.isReady,
				score: p.score
			}));

			io.to(roomId).emit('room_state', {
				players,
				settings: room.settings,
				status: room.status,
				code: room.code,
				name: room.name,
				hostId: room.hostId
			});
		}
	});

	socket.on('player_ready', ({ roomId, isReady }) => {
		console.log(`🎮 Игрок ${socket.userId} готовность: ${isReady}`);
		const room = rooms.get(roomId);
		if (room && room.players.has(socket.userId)) {
			const player = room.players.get(socket.userId);
			player.isReady = isReady;
			room.players.set(socket.userId, player);

			const players = Array.from(room.players.values()).map(p => ({
				userId: p.userId,
				nickname: p.nickname,
				avatarUrl: p.avatarUrl,
				isReady: p.isReady,
				score: p.score
			}));

			io.to(roomId).emit('room_state', {
				players,
				settings: room.settings,
				status: room.status,
				code: room.code,
				name: room.name,
				hostId: room.hostId
			});
		}
	});

	socket.on('start_game', async ({ roomId }) => {
		console.log(`🚀 Запрос на старт игры от ${socket.userId} в комнате ${roomId}`);
		const room = rooms.get(roomId);
		if (!room || room.hostId !== socket.userId) {
			console.log('❌ Не хост или комната не найдена');
			return;
		}

		const allReady = Array.from(room.players.values()).every(p => p.isReady);
		const enoughPlayers = room.players.size >= 2;

		if (!allReady || !enoughPlayers) return;

		room.status = 'playing';
		room.currentQuestion = 0;
		room.answers.clear();
		room.selectedQuestions = getRandomQuestions(room.settings.questionsCount);
		console.log(`📚 Выбрано ${room.selectedQuestions.length} случайных вопросов`);

		for (let [userId, player] of room.players) {
			player.score = 0;
			room.players.set(userId, player);
		}

		io.to(roomId).emit('game_starting', { countdown: 3 });

		setTimeout(() => {
			sendNextQuestion(io, roomId);
		}, 3000);
	});

	socket.on('submit_answer', ({ roomId, answerIndex, timeSpent }) => {
		const room = rooms.get(roomId);
		if (!room || room.status !== 'playing') return;

		if (room.answers.has(`${socket.userId}_${room.currentQuestion}`)) return;

		if (!room.selectedQuestions) return;
		const question = room.selectedQuestions[room.currentQuestion];
		if (!question) return;

		const isCorrect = answerIndex === question.correctAnswer;
		const timeLeft = Math.max(0, room.settings.timeLimit - timeSpent);
		const points = calculatePoints(isCorrect, timeLeft, room.settings.timeLimit);

		room.answers.set(`${socket.userId}_${room.currentQuestion}`, { answerIndex, points });

		if (points > 0) {
			const player = room.players.get(socket.userId);
			if (player) {
				player.score += points;
				room.players.set(socket.userId, player);
			}
		}

		socket.emit('answer_result', {
			isCorrect,
			pointsEarned: points,
			correctAnswer: question.correctAnswer
		});
	});

	socket.on('disconnect', () => {
		if (currentRoomId) {
			const room = rooms.get(currentRoomId);
			if (room) {
				room.players.delete(socket.userId);

				const players = Array.from(room.players.values()).map(p => ({
					userId: p.userId,
					nickname: p.nickname,
					avatarUrl: p.avatarUrl,
					isReady: p.isReady,
					score: p.score
				}));

				io.to(currentRoomId).emit('player_left', { userId: socket.userId, players });

				if (room.players.size === 0) {
					rooms.delete(currentRoomId);
				}
			}
		}
		console.log('🔌 Пользователь отключился:', socket.userId);
	});
});

async function sendNextQuestion(io, roomId) {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    if (room.currentQuestion >= room.settings.questionsCount) {
        endGame(io, roomId);
        return;
    }

    if (!room.selectedQuestions) {
        room.selectedQuestions = getRandomQuestions(room.settings.questionsCount);
    }

    const question = room.selectedQuestions[room.currentQuestion];
    if (!question) return;

    io.to(roomId).emit('new_question', {
        id: question.id,
        text: question.text,
        options: question.options,
        timeLimit: room.settings.timeLimit,
        current: room.currentQuestion + 1,
        total: room.settings.questionsCount
    });

    setTimeout(async () => {
        room.currentQuestion++;
        sendNextQuestion(io, roomId);
    }, room.settings.timeLimit * 1000 + 2000);
}

async function endGame(io, roomId) {
	const room = rooms.get(roomId);
	if (!room) return;

	room.status = 'finished';

	const results = Array.from(room.players.values())
		.sort((a, b) => b.score - a.score)
		.map((player, index) => ({
			rank: index + 1,
			userId: player.userId,
			nickname: player.nickname,
			avatarUrl: player.avatarUrl,
			score: player.score
		}));

	for (const player of room.players.values()) {
		const user = users.get(player.userId);
		if (user) {
			user.gamesPlayed++;
			user.totalScore += player.score;
			if (results[0] && results[0].userId === player.userId) {
				user.wins++;
			}
			user.correctAnswers += Math.floor(player.score / 15);
		}
	}
	saveUsers();

	io.to(roomId).emit('game_over', { results, winner: results[0] });

	setTimeout(() => {
		rooms.delete(roomId);
	}, 30000);
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
	console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});