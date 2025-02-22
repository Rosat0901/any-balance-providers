﻿/**
Провайдер AnyBalance (http://any-balance-providers.googlecode.com)
*/

var g_headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
    'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8,ru-RU;q=0.7',
    'Connection': 'keep-alive',
    Origin: 'https://www.sportmaster.ru',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.120 Safari/537.36',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
	'Cache-Control': 'max-age=0',
	'Upgrade-Insecure-Requests': '1',
	'Sec-Fetch-User': '?1',                   	
	'Referer': 'https://www.sportmaster.ru/user/session/login.do?continue=%2F',
};

var g_cardTypes = [
    {},
    { auth: 'COMMON', check: '300', name: 'Обычный' },
    { auth: 'SILVER', check: '301', name: 'Серебряный' },
    { auth: 'GOLD', check: '302', name: 'Золотой' }
];

var g_savedData;
var replaceNumber = [replaceTagsAndSpaces, /\D/g, '', /.*(\d)(\d\d\d)(\d\d\d)(\d\d)(\d\d)$/, '+$1 $2 $3-$4-$5'];

function saveTokens(json){
	g_savedData.set('accessToken', json.AccessToken);
	g_savedData.set('accessTokenExpire', json.AccessTokenExpire);
	g_savedData.set('refreshToken', json.RefreshToken);
	g_savedData.set('refreshTokenExpire', json.RefreshTokenExpire);
}

function callApi(action, params, method){
    var androidId = g_savedData.get('androidId');
	if(!androidId){
		var prefs = AnyBalance.getPreferences();
		androidId = hex_md5(prefs.login).substr(0, 16);
	}

	var headers = {
		'User-Agent': 'mobileapp-android-9',
		'Device-Model': 'OnePlus ONEPLUS A3010',
		'App-Version': '3.70.42',
		'OS': 'ANDROID',
		'OS-Version': '9',
		'Build-Mode': 'Production',
		'Accept-Encoding': 'identity',
		'X-SM-MobileApp': androidId,
		Connection: 'Keep-Alive'
	};

	var accessToken = g_savedData.get('accessToken');
    if(!accessToken && (action !== 'auth')){
    	var json = callApi('auth');
    	saveTokens(json);
    	accessToken = json.AccessToken;
    }

    if(accessToken){
    	headers['Access-Token'] = accessToken;
    }

	if(params)
		headers['Content-Type'] = 'application/json; charset=utf-8';

	var html = AnyBalance.requestPost('https://moappsmapi.sportmaster.ru/api/v1/' + action, params ? JSON.stringify(params) : null, headers, {HTTP_METHOD: method || 'GET'});
	var json = getJson(html);
	if(json.error){
		AnyBalance.trace(html);
		throw new AnyBalance.Error(json.error.title, /42/i.test(json.error.title) ? true : null, /телефон|парол/i.test(json.error.title));
	}
		
	return json.data;
}

function mainAPI(){
    var prefs = AnyBalance.getPreferences();
    AnyBalance.setDefaultCharset('utf-8');

    AB.checkEmpty(prefs.login, 'Введите номер телефона!');
    AB.checkEmpty(/^\d{10}$/.test(prefs.login), 'Введите номер телефона - 10 цифр без пробелов и разделителей!');

    g_savedData = new SavedData('sport_master', prefs.login);

    AnyBalance.trace ('Пробуем получить данные из мобильного приложения...');

    
    var json;
    try{
    	json = getInfo();
    }catch(e){
		AnyBalance.trace("Error getting info: " + JSON.stringify(json));
		if(/Token expired|invalid/i.test(e.message)){
			AnyBalance.trace("Trying to refresh token");
			g_savedData.set('accessToken', undefined); 
			var refreshToken = g_savedData.get('refreshToken');
			try{
    			json = callApi('auth', {RefreshToken: refreshToken}, 'POST');
    			saveTokens(json);
    			json = getInfo();
    		}catch(e){
				AnyBalance.trace("Error refreshing token: " + JSON.stringify(json));
    			if(/Token expired|invalid/i.test(e.message)){
    				saveTokens({});
    				json = getInfo();	
    			}else{
    				throw e;
    			}
    		}
		}else{
			throw e;
		}
    }

	
    if(!json.customer){
    	json = callApi('code', {type: 'phone', value: prefs.login}, 'POST');
    	AnyBalance.trace('Sending code: ' + JSON.stringify(json));

    	var code = AnyBalance.retrieveCode('Пожалуйста, введите SMS для подтверждения входа в личный кабинет Спортмастер', null, {inputType: 'number', time: json.waitSeconds*1000});

    	json = callApi('auth', {phone: prefs.login, token: code, type: 'sms'}, 'POST');
    	saveTokens(json);

    	json = getInfo();
		AnyBalance.trace(JSON.stringify(json));
    }

    g_savedData.save();

    var result = {success: true};

    if(AnyBalance.isAvailable('__tariff', 'cardnum', 'balance', 'nextlevel', 'fio', 'phone')){
	    AB.getParam(json.bonusCurLevel, result, '__tariff');
	    AB.getParam(json.cardNum, result, 'cardnum');
        AB.getParam(json.bonusAmount, result, 'balance', null, null, parseBalance);
        AB.getParam(json.toNextLevelSumma, result, 'nextlevel', null, null, parseBalance);
        var fio = json.firstName; // Если пользователь не указал в профиле фамилию, значение свойства "name" имеет вид "Имя null", поэтому делаем в виде сводки
	    if (json.lastName)
	    	fio+=' '+json.lastName;
	    AB.getParam(fio, result, 'fio');
	    AB.getParam(json.customer.phone, result, 'phone', null, replaceNumber);
	}

    if(AnyBalance.isAvailable('buysum', 'till', 'sumtill', 'cashback', 'promo')){
    	json = callApi('auth/bonus');
		AnyBalance.trace(JSON.stringify(json));
		AB.getParam(json.clientInfo.buySumma, result, 'buysum', null, null, parseBalance);
        var balance = 0, minExpDate, minExpSum;
        if(json.clientInfo.bonuses){
        	var balance = json.clientInfo.bonuses.reduce(function(acc, a){
        		var dt = parseDateISO(a.dateEnd);
        		if(a.amount && (!isset(minExpDate) || minExpDate > dt)){
        			minExpDate = dt;
        			minExpSum = a.amount;
        		}
        		return acc+=a.amount;
        	}, 0);

			getParam(minExpDate, result, 'till');
			getParam(minExpSum, result, 'sumtill', null, null, parseBalance);
        }
        if(json.details){
        	var cashback=0, promo=0;
        	for(var i=0; i<json.details.length; ++i){
        		var d = json.details[i];
        		if(d.bonusTypeCode === 7)
        			cashback += d.amount;
        		if(d.bonusTypeCode === 8)
        			promo += d.amount;
        	}
			getParam(cashback, result, 'cashback', null, null, parseBalance);
			getParam(promo, result, 'promo', null, null, parseBalance);
        }
    }

    if(AnyBalance.isAvailable('last_order_date', 'last_order_number', 'last_order_status', 'last_order_sum')){
        json = callApi('orders?pageNumber=1&pageSize=15');
		AnyBalance.trace(JSON.stringify(json));
        if(json.length){
        	var o = json[0];
        	getParam(o.orderDate, result, 'last_order_date');
        	getParam(o.number, result, 'last_order_number');
        	getParam(o.orderPrice, result, 'last_order_sum', null, null, parseBalance);
        	getParam(o.statusTitle, result, 'last_order_status');
        }else{
			AnyBalance.trace('Последний заказ не найден');
		}
    }

    AnyBalance.setResult(result);
}

function getInfo(){
    var json = callApi('auth/profile');
    return json;
}
