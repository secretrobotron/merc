var sys = require( 'sys' );
var http = require( 'http' );

var functions = {};

E_INVALID_REQUEST = 'invalid request';
E_UNSUPPORTED_REQUEST_METHOD = 'unsupported request method';
E_METHOD_NOT_EXPORTED = 'method not exported';

var JSONRPC_Client = function( port, host ) {
	this.port = port;
	this.host = host;

	this.call = function( method, path, args, callback, errback ) {
		var encodedRequest = JSON.stringify( {
			'id': '' + ( new Date() ).getTime(),
			'method': method,
			'args': args
		} );

		var headers = {
			'Host': host,
			'Content-Length': encodedRequest.length,
		};

		var options = {
			host: host,
			port: port,
			path: path,
			method: 'POST',
			headers: headers,
		};

		var req = http.request( options, function( res ) {
			var encodedResponse = '';

			res.addListener( 'data', function( chunk ) {
				encodedResponse = encodedResponse + chunk;
			} );

			res.addListener( 'end', function() {
				var decodedResponse = JSON.parse( encodedResponse );
				if( decodedResponse.hasOwnProperty( 'result' ) ) {
					if( callback ) {
						callback( decodedResponse.result );
					}
				}
				else {
					if( errback ) {
						errback( decodedResponse.error );
					}
				}
			} );

		} );
		req.addListener( 'error', function( error ) {
			console.log( error );
		} );
		req.write( encodedRequest );
		req.end();
	};
}

var JSONRPC = {

	functions: functions,

	exposeModule: function( mod, obj ) {
		var funcs = [];
		for( var funcName in obj ) {
			var funcObj = obj[funcName];
			if( typeof( funcObj ) == 'function' ) {
				functions[ mod + '.' + funcName ] = funcObj;
				funcs.push( funcName );
			}
		}
		JSONRPC.trace( '***', 'exposeModule: ' + mod + ' [' + funcs.join( ', ' ) + ']' );
		return obj;
	},

	expose: function( name, func ) {
		JSONRPC.trace( '***', 'expose: ' + name );
		functions[name] = func;
	},

	listen: function( port, host ) {
		JSONRPC.server.listen( port, host );
		JSONRPC.trace( '***', 'listen: http://' + (host || '127.0.0.1') + ':' + port + '/' );
	},

	server: http.createServer( function( req, res ) {
		JSONRPC.handle_Request( req, res )
	}),

	trace: function( direction, message ) {
		sys.puts( '   ' + direction + '   ' + message );
	},

	client: function( port, host ) {
		return new JSONRPC_Client( port, host );
	},

	handle_Request: function( req, res ) {
		JSONRPC.trace( '<--', 'accepted request' );
		if( req.method === 'POST' ) {
			JSONRPC.handle_POST( req, res );
		}
		else {
			JSONRPC.handle_UnsupportedRequestMethod( req, res );
		}
	},

	handle_UnsupportedRequestMethod: function( req, res ) {
		JSONRPC.trace( '-->', 'E_UNSUPPORTED_REQUEST_METHOD' );
		res.writeHead( 405, [ ['Content-Type', 'text/plain'],
							  ['Content-Length', E_UNSUPPORTED_REQUEST_METHOD.length],
							  ['Allow', 'POST' ] ] );
		res.write( E_UNSUPPORTED_REQUEST_METHOD );
		res.end();
	},

	handle_InvalidRequest: function( req, res ) {
		JSONRPC.trace( '-->', 'E_INVALID_REQUEST' );
		res.writeHead( 400, [ ['Content-Type', 'text/plain'],
							  ['Content-Length', E_INVALID_REQUEST.length] ] );
		res.write( E_INVALID_REQUEST );
		res.end();
	},

	handle_MethodNotExported: function( req, res ) {
		JSONRPC.trace( '-->', 'E_METHOD_NOT_EXPORTED' );
		res.writeHead( 400, [ ['Content-Type', 'text/plain'],
							  ['Content-Length', E_METHOD_NOT_EXPORTED.length] ] );
		res.write( E_METHOD_NOT_EXPORTED );
		res.end();
	},

	handle_POST: function( req, res ) {
		var encodedRequest = '';

		req.addListener( 'data', function( chunk ) {
			JSONRPC.trace( '<--', 'chunk: ' + chunk );
			encodedRequest = encodedRequest + chunk;
		});

		req.addListener( 'end', function() {
			var decodedRequest = JSON.parse( encodedRequest );

			if( !(decodedRequest.hasOwnProperty( 'id' ) && 
				  decodedRequest.hasOwnProperty( 'method' ) && 
				  decodedRequest.hasOwnProperty( 'args' ) ) ) {
				return JSONRPC.handle_InvalidRequest( req, res );
			}
			if( !JSONRPC.functions.hasOwnProperty( decodedRequest.method ) ) {
				return JSONRPC.handle_MethodNotExported( req, res );
			}

			var onSuccess = function( result ) {
				JSONRPC.trace( '-->', 'response (id ' + decodedRequest.id + '): ' + JSON.stringify( result ) );
				var encodedResponse = JSON.stringify( {
					'id': decodedRequest.id,
					'error': null,
					'result': result
				} );

				res.writeHead( 200, [ ['Content-Type', 'application/json'],
									   ['Content-Length', encodedResponse.length] ] );
				res.write( encodedResponse );
				res.end();
			};

			var onFailure = function( error ) {
				JSONRPC.trace( '-->', 'error (id ' + decodedRequest.id + '): ' + JSON.stringify( error ) );
				var encodedResponse = JSON.stringify( {
					'id': decodedRequest.id,
					'error': error,
					'result': null
				} );

				res.writeHead( 200, [ ['Content-Type', 'application/json'],
									   ['Content-Length', encodedResponse.length] ] );
				res.write( encodedResponse );
				res.end();
			};

			JSONRPC.trace( '<--', 'request (id ' + decodedRequest.id + '): ' + decodedRequest.method + '(' + decodedRequest.result + ')' );
			var method = JSONRPC.functions[ decodedRequest.method ];
			var result = null;
			decodedRequest.args = decodedRequest.args.concat( [ onSuccess, onFailure ] );
			try {
				result = method.apply( null, decodedRequest.args );
			}
			catch( error ) {
				return onFailure( error );
			}
		});
	},

};

exports.JSONRPC = JSONRPC;
