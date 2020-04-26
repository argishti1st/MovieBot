const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const mongoose = require('mongoose');
const geolib = require('geolib');
const _ = require('lodash');

const config = require('./src/config');
const helper = require('./src/helper');
const kb = require('./src/keyboard-buttons');
const keyboard = require('./src/keyboard');
const database = require('./database.json');

const Film = require('./src/models/film-model');
const Cinema = require('./src/models/cinema');
const User = require('./src/models/user');

//database.films.forEach(f => new Film(f).save().catch(err => {console.log(err)}));
// database.cinemas.forEach(f => new Cinema(f).save().catch(err => {console.log(err)}));
const ACTION_TYPE = {
    TOGGLE_FAV_FILM : 'tff',
    SHOW_CINEMAS : 'sc',
    SHOW_CINEMAS_MAP : 'scm',
    SHOW_FILMS : 'sf'
}

//******************** */

mongoose.connect(config.DB_URL, {
    useMongoClient : true
})
.then(() => {
    console.log('connected');
})
.catch(err => {
    console.log(err);
})

const bot = new TelegramBot(config.TOKEN, {
    polling : {
        interval : 300,
        autoStart : true,
        params : {
            timeout : 10
        }
    }
});

bot.on('message', msg => {
    console.log('done ' + msg.from.first_name)
    const chatId = helper.getChatId(msg);

    switch(msg.text) {
        case kb.home.favorite:
            showFavoriteFilms(chatId, msg.from.id);
            break
        case kb.home.films:
            bot.sendMessage(chatId, `Choose a category..`, {
                reply_markup : {
                    keyboard : keyboard.films
                }
            })
            break
        case kb.film.comedy: 
            sendFilmsByQuery(chatId, {type : 'comedy'});
            break
        case kb.film.action: 
            sendFilmsByQuery(chatId, {type : 'action'});
            break
        case kb.film.random: 
            sendFilmsByQuery(chatId, {});
            break
        case kb.home.cinemas:
            bot.sendMessage(chatId, `Send location`, {
                reply_markup : {
                    keyboard : keyboard.cinemas
                }
            })
            break
        case kb.back:
            bot.sendMessage(chatId, `What would you like to watch?`, {
                reply_markup : {
                    keyboard : keyboard.home
                }
            })
            break
    }
    if(msg.location){
        console.log(msg.location);
        getCinemasInCoord(chatId, msg.location);
    }
});

bot.onText(/\/start/, msg => {
    let text = `Hello, ${msg.from.first_name} \n choose command for starting `;
    const id = helper.getChatId(msg);
    bot.sendMessage(id, text, {
        reply_markup: {
            keyboard: keyboard.home
        }
    });
});

bot.onText(/\/f(.+)/, (msg, [source, match]) => {
    const filmUid = helper.getItemUuid(source);
    const chatId = helper.getChatId(msg);
    // console.log(filmUid);
    Promise.all([
        Film.findOne({uuid : filmUid}),
        User.findOne({telegramId : msg.from.id})
    ])
    .then(([film, user]) => {
        let isFav = false;
        if(user){
            isFav = user.films.indexOf(film.uuid) !== -1;
        }
        const favText = isFav ? 'Delete from Favorites' : 'Add to favorites'

        const caption = `Name : ${film.name} \n Year: ${film.year} \n Rating: ${film.rate} \n Length: ${film.length} \n Country: ${film.country}`
        bot.sendPhoto(chatId, film.picture, {
            caption : caption,
            reply_markup: {
                inline_keyboard : [
                    [
                        {
                            text: favText,
                            callback_data: JSON.stringify({
                                type : ACTION_TYPE.TOGGLE_FAV_FILM,
                                filmUuid : film.uuid,
                                isFav : isFav
                            })
                        },
                        {
                            text: 'Show cinemas',
                            callback_data: JSON.stringify({
                                type : ACTION_TYPE.SHOW_CINEMAS,
                                cinemaUuids : film.cinemas
                            })
                        }
                    ],
                    [
                        {
                            text: `link to Kinopoisk ${film.name}`,
                            url: film.link
                        }
                    ]
                ]
            }
        })
    })
});

bot.onText(/\/c(.+)/, (msg, [source, match]) => {
    const cinemaUuid = helper.getItemUuid(source);
    const chatId = helper.getChatId(msg);
    // console.log(filmUid);
    
    Cinema.findOne({uuid : cinemaUuid})
    .then(cinema => {
        console.log(cinema.location.latitude, cinema.location.longitude);

        bot.sendMessage(chatId, `Cinema ${cinema.name}`, {
            reply_markup : {
                inline_keyboard : [
                    [
                        {
                            text : cinema.name,
                            url : cinema.url
                        },
                        {
                            text : 'Show on map',
                            callback_data : JSON.stringify({
                                type : ACTION_TYPE.SHOW_CINEMAS_MAP,
                                lat : cinema.location.latitude,
                                lon : cinema.location.longitude
                            })
                        }
                    ],
                    [
                        {
                            text : 'Show movies',
                            callback_data : JSON.stringify({
                                type : ACTION_TYPE.SHOW_FILMS,
                                filmUuids : cinema.films
                            })
                        }
                    ]
                ]
            }
        })
    })
});

bot.on('callback_query', query => {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    let data;
    try {
        data = JSON.parse(query.data);
    } catch (error) {
        throw new Error('Data is not an object');
    }

    const {type} = data;
    console.log(type, data.lat, data.lon);
    if (type === ACTION_TYPE.SHOW_CINEMAS_MAP) {        
        const {lat, lon} = data;
        bot.sendLocation(query.message.chat.id, lat, lon);
    } else if (type === ACTION_TYPE.SHOW_CINEMAS){
        showCinemas(userId, data);
    } else if (type === ACTION_TYPE.TOGGLE_FAV_FILM){
        toggleFavoriteFilm(userId, query.id, data);
    } else if(type === ACTION_TYPE.SHOW_FILMS){
        sendFilmsByQuery(userId, {uuid : {'$in' : data.filmUuids}});
    }
});

bot.on('inline_query', query => {
    Film.find()
    .then(films => {
        const results = films.map(f => {
            const caption = `Name : ${f.name} \n Year: ${f.year} \n Rating: ${f.rate} \n Length: ${f.length} \n Country: ${f.country}`
            return {
                id : f.uuid,
                type : 'photo',
                photo_url : f.picture,
                thumb_url : f.picture,
                caption : caption,
                reply_markup : {
                    inline_keyboard : [
                        [
                            {
                                text : `Kinopois ${f.name}`,
                                url : f.link
                            }
                        ]
                    ]
                }
            }
        })
        bot.answerInlineQuery(query.id, results, {
            cache_time : 0
        });
    })
})

//=====================================================
async function sendFilmsByQuery(chatId, query) {
    const films = await Film.find(query);
    const html = films.map((f, i) => {
        return `<b>${i + 1}</b> ${f.name} - /f${f.uuid}`
    }).join('\n');

    sendHTML(chatId, html, 'films');
};

function sendHTML(chatId, html, kbName = null) {
    const options = {
        parse_mode : 'HTML'
    };
    if(kbName){
        options['reply_markup'] = {
            keyboard : keyboard[kbName]
        };
    }

    bot.sendMessage(chatId, html, options);
}

function getCinemasInCoord(chatId, location) {
    Cinema.find()
    .then(cinemas => {
        cinemas.forEach(c=> {
            c.distance = geolib.getDistance(location, c.location) / 1000;
        })
        cinemas = _.sortBy(cinemas, 'distance');
        const html = cinemas.map((c, i) => {
            return `<b>${i+1}</b> ${c.name}. <em>Distance</em> - <strong>${c.distance}</strong> km. /c${c.uuid}`
        }).join('\n');
        sendHTML(chatId, html, 'home'); 
    })
    .catch(err => {console.log(err)});
}

function toggleFavoriteFilm(userId, queryId, {filmUuid, isFav}) {
    // console.log(filmUuid, userId, queryId, isFav)
    let userPromise;
    User.findOne({telegramId : userId})
    .then(user => {
        if(user){
            if(isFav) {
                user.films = user.films.filter(fUuid => fUuid !== filmUuid);
            } else{
                user.films.push(filmUuid);
            }
            userPromise = user;
        } else {
            userPromise = new User({
                telegramId : userId,
                films : [filmUuid]
            });
        }
        
        return userPromise.save()
    })
    .then(result => {
        let answerText = isFav ? 'Deleted' : 'Added'
        bot.answerCallbackQuery({
            callback_query_id : queryId,
            text : answerText
        });
    })
    .catch(err => {console.log(err)});
}

function showFavoriteFilms(chatId, userId){
    User.findOne({telegramId : userId})
    .then(user => {
        if(user){
            return Film.find({uuid : {'$in' : user.films}})
        } else {
            sendHTML(chatId, 'You have not added to favorites anything', 'home');
        }
    })
    .then(films => {
        let html;
        if(films.length) {
            html = films.map((f, i) => {
                return `<b>${i+1}</b> ${f.name} - <b>${f.rate}</b> (/f${f.uuid})`
            }).join('\n')
        } else {
            html = 'You have not added to favorites anything'
        }

        sendHTML(chatId, html, 'home');
    })
    .catch(err => {console.log(err);
    })
}

function showCinemas(userId, {cinemaUuids}) {
    console.log('aaaaaaa')
    Cinema.find({uuid : {'$in' : cinemaUuids}})
    .then(cinemas => {
        let html;
        if(cinemas.length) {
            html = cinemas.map((c, i) => {
                return `<b>${i+1}</b> ${c.name} - (/c${c.uuid})`
            }).join('\n')
        } else {
            html = 'No cinema is showing this film'
        }

        sendHTML(userId, html, 'home');
    })
    .catch(err => {console.log(err);
    })
}