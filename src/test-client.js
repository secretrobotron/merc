var sys = require( 'sys' );
var rpc = require( './json-rpc' ).JSONRPC;

var client = rpc.client( 8080, 'localhost' );

function createSession( callback ) {
	client.call( 'createSession', null, [], function( result ) {
		sys.puts( 'sessionToken: ' + result );
		if( callback )
			callback( result );
	} );
}

function createChannel( sessionToken, callback ) {
	client.call( 'createChannel', null, [ sessionToken, 10, null ], function( result ) {
		sys.puts( 'channelToken: ' + result );
		if( callback )
			callback();
	} );
}

createSession( createChannel );
