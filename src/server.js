var sys = require( 'sys' );
var crypto = require( 'crypto' );
var timers = require( 'timers' );
var uuid = require( 'uuid' );
var rpc = require( './json-rpc' ).JSONRPC;

var hashAlgorithm = 'sha1';

var options = {
	sessionTimeout: 60 * 1000,	// Sessions time out after 1 minute.
	channelTimeout: 0 * 1000,	// Channels time out as soon as the last session quits.
	maxSessions: 100,
	messageQueueCapacity: 100,
	maxMessageSize: 1024,
};

var messageService = {

	sessions: {},
	channels: {},
	sessionCount: 0,

	trace: function( message ) {
		sys.puts( '   ***   ' + message );
	},

	isValidSession: function( sessionToken ) {
		return( sessionToken in messageService.sessions );
	},

	isValidChannel: function( channelToken ) {
		return( channelToken in messageService.channels );
	},

	_resetSessionTimeout: function( sessionToken ) {
		var session = messageService.sessions[ sessionToken ];
		if( session.timeout ) {
			timers.clearTimeout( session.timeout );
			session.timeout = null;
		}
		session.timeout = timers.setTimeout( function() {
			messageService._deleteSession( sessionToken );
		}, options.sessionTimeout );
		messageService.trace( '_resetSessionTimeout: ' + sessionToken );
	},

	createSession: function( callback, errback ) {
		if( messageService.sessionCount == options.maxSessions ) {
			errback( 'unable to create session' );
			return;
		}

		var sessionId = uuid.generate();

		var hash = crypto.createHash( hashAlgorithm );
		hash.update( sessionId );
		sessionToken = hash.digest( 'hex' );
		if( sessionToken in messageService.sessions ) {
			errback( 'unable to create session' );
			return;
		}

		var session = {};
		session.sessionId = sessionId;
		messageService.sessions[ sessionToken ] = session;
		++ messageService.sessionCount;
		messageService.trace( 'createSession: ' + sessionToken );

		messageService._resetSessionTimeout( sessionToken );

		callback( sessionToken );
	},

	_deleteSession: function( sessionToken, callback, errback ) {
		var session = messageService.sessions[ sessionToken ];
		if( session.hasOwnProperty( 'channelToken' ) ) {
			messageService._quitChannel( sessionToken );
		}

		if( session.timeout ) {
			timers.clearTimeout( session.timeout );
			session.timeout = null;
		}

		delete messageService.sessions[ sessionToken ];
		-- messageService.sessionCount;
		messageService.trace( '_deleteSession (timeout): ' + sessionToken );
	},

	createChannel: function( sessionToken, capacity, passwordHash, callback, errback ) {
		if( !messageService.isValidSession( sessionToken ) ) {
			errback( 'invalid session token' );
			return;
		}
		messageService._resetSessionTimeout( sessionToken );
 
		var hash;
		var channelId = uuid.generate();

		hash = crypto.createHash( hashAlgorithm );
		hash.update( channelId );
		channelToken = hash.digest( 'hex' );
		if( channelToken in messageService.channels ) {
			errback( 'unable to create channel' );
			return;
		}

		var channel = {};
		channel.channelId = channelId;
		channel.capacity = capacity;
		channel.passwordHash = passwordHash;
		messageService.channels[ channelToken ] = channel;
		messageService.trace( 'createChannel: ' + channelToken );

		channel.sessions = {};
		channel.queues = {};
		channel.count = 0;
		channel.nextQueueId = 0;

		try {
			messageService._joinChannel( sessionToken, channelToken, passwordHash );
		}
		catch( error ) {
			errback( error );
		}

		callback( channelToken );
	},

	_deleteChannel: function( channelToken, callback, errback ) {
		var channel = messageService[ channelToken ];
		for( var sessionToken in channel.sessions ) {
			messageService._quitChannel( sessionToken );
		}

		delete messageService.channels[ channelToken ];
		messageService.trace( '_deleteChannel (timeout): ' + channelToken );
	},

	_joinChannel: function( sessionToken, channelToken, passwordHash ) {
		var channel = messageService.channels[ channelToken ];
		if( channel.sessions.length == channel.capacity ) {
			throw( 'channel at maximum capacity' );
		}

		if( channel.timeout ) {
			timers.clearTimeout( channel.timeout );
			delete channel[ 'timeout' ];
		}

		var session = messageService.sessions[ sessionToken ];
		if( session.channelToken ) {
			quitChannel( sessionToken, callback, errback );
		}

		channel.sessions[ sessionToken ] = session;
		var queueId = channel.nextQueueId ++;
		channel.queues[ queueId.toString() ] = session;
		++ channel.count;

		session.queueId = queueId;
		session.channelToken = channelToken;
		session.messages = [];

		messageService.trace( '_joinChannel: ' + sessionToken + ' join ' + channelToken + '/' + session.queueId );
	},
	
	joinChannel: function( sessionToken, channelToken, passwordHash, callback, errback ) {
		if( !messageService.isValidSession( sessionToken ) ) {
			errback( 'invalid session token' );
			return;
		}
		messageService._resetSessionTimeout( sessionToken );

		if( !messageService.isValidChannel( channelToken ) ) {
			errback( 'invalid channel token' );
			return;
		}

		var channel = messagesService.channels[ channelToken ];
		if( channel.passwordHash &&
			channel.passwordHash != passwordHash ) {
			errback( 'incorrect channel password' );
			return;
		}

		try {
			messageService._joinChannel( sessionToken, channelToken, passwordHash );
		}
		catch( error ) {
			errback( error );
		}

		callback();
	},

	_quitChannel: function( sessionToken ) {
		var session = messageService.sessions[ sessionToken ];
		if( session.channelToken ) {	
			if( channelToken in messageService.channels ) {
				var channel = messageService.channels[ channelToken ];
				if( sessionToken in channel.sessions ) {
					delete channel.sessions[ sessionToken ];
					delete channel.queues[ session.queueId ];
					-- channel.count;

					if( channel.count == 0 ) {
						channel.timeout = timers.setTimeout( function() {
							messageService._deleteChannel( channelToken );
						}, options.channelTimeout );
					}
				}
			}

			delete session[ 'channelToken' ];
			delete session[ 'queueId' ];
			delete session[ 'messages' ];

			messageService.trace( '_quitChannel: ' + sessionToken + ' quit ' + session.channelToken );
		}
	},

	quitChannel: function( sessionToken, callback, errback ) {
		if( !messageService.isValidSession( sessionToken ) ) {
			errback( 'invalid session token' );
			return;
		}
		messageService._resetSessionTimeout( sessionToken );

		try {
			messageService._quitChannel( sessionToken );
		}
		catch( error ) {
			errback( error );
			return;
		}

		callback();
	},

	_sendMessage: function( channelToken, sourceQueueId, destinationQueueId, data ) {
		var channel = messageService.channels[ channelToken ];
		var destination = channel.queues[ destinationQueueId ];

		if( destination.messages.length == options.maxQueueCapacity ) {
			return false;
		}
		else {
			var message = { 'source': sourceQueueId, 'data': data };
			destination.messages.push( message );
			messageService.trace( '_sendMessage (' + channelToken + ': ' + sourceQueueId + ' -> ' + destinationQueueId );
		}
	},

	sendMessage: function( sessionToken, destinationQueueId, data, callback, errback ) {
		if( !messageService.isValidSession( sessionToken ) ) {
			errback( 'invalid session token' );
			return;
		}
		messageService._resetSessionTimeout( sessionToken );

		if( data.length > options.maxMessageSize ) {
			errback( 'message is larger than maximum data size (' + options.maxDataSize + ' bytes )' );
			return;
		}

		var session = messageService.sessions[ sessionToken ];
		var channel = messageService.channels[ session.channelToken ];

		var messagesSent = [];
		if( destinationQueueId === '*' ) {
			for( var q in channel.queues ) {
				if( destinationQueueId != session.queueId && 
				    messageService._sendMessage( channelToken, session.queueId, q, data ) ) {
					messagesSent.push( q );
				}
			}
		}
		else {
			if( !( destinationQueueId in channel.queues ) ) {
				errback( 'invalid destination queue' );
				return;
			}

				if( destinationQueueId != session.queueId && 
				    messageService._sendMessage( channelToken, session.queueId, destinationQueueId, data ) ) {
					messagesSent.push( destinationQueueId );
				}
		}

		callback( messagesSent );
	},

	receiveMessages: function( sessionToken, callback, errback ) {
		if( !messageService.isValidSession( sessionToken ) ) {
			errback( 'invalid session token' );
			return;
		}
		messageService._resetSessionTimeout( sessionToken );
		
		var session = messageService.sessions[ sessionToken ];
		var messages = session.messages;
		session.messages = [];

		messageService.trace( 'receiveMessages: ' + sessionToken );

		callback( messages );
	}

}
rpc.expose( 'createSession', messageService.createSession );
rpc.expose( 'createChannel', messageService.createChannel );
rpc.expose( 'joinChannel', messageService.joinChannel );
rpc.expose( 'quitChannel', messageService.quitChannel );
rpc.expose( 'sendMessage', messageService.sendMessage );
rpc.expose( 'receiveMessages', messageService.receiveMessages );

rpc.listen( 8080, 'localhost' );
