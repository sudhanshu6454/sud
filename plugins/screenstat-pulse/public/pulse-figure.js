/* Screenstat Pulse — hydrates public figure blocks from /public/films/{slug} so a cached page still
   shows today's reading. Read-only; failures leave the server-rendered figure as it is. */
( function () {
	var cfg = window.SSPULSE_PUBLIC; if ( ! cfg ) return;
	var fmtIn = function ( v, dec ) { return Math.abs( v ).toLocaleString( 'en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec } ); };
	var cr = function ( v ) { return '₹' + fmtIn( v, 2 ) + ' cr'; };
	var people = function ( v ) { return v >= 1e7 ? fmtIn( v / 1e7, 2 ) + ' cr' : v >= 1e5 ? fmtIn( v / 1e5, 1 ) + ' lakh' : fmtIn( v, 0 ); };
	var change = function ( d, dec, unit ) {
		if ( Math.abs( d ) < Math.pow( 10, -dec ) / 2 ) return '<span class="ss-figure__change">— 0' + ( dec ? '.' + '0'.repeat( dec ) : '' ) + ( unit || '' ) + '</span>';
		return '<span class="ss-figure__change ' + ( d > 0 ? 'is-up' : 'is-down' ) + '">' + ( d > 0 ? '▲ +' : '▼ −' ) + fmtIn( d, dec ) + ( unit || '' ) + '</span>';
	};
	var esc = function ( s ) { return String( s ).replace( /[&<>"]/g, function ( c ) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ]; } ); };
	document.querySelectorAll( '.ss-figure[data-sspulse]' ).forEach( function ( fig ) {
		fetch( cfg.restUrl + encodeURIComponent( fig.dataset.sspulse ), { credentials: 'omit' } ).then( function ( r ) { return r.ok ? r.json() : null; } ).then( function ( p ) {
			if ( ! p || ! p.reading ) return;
			var r = p.reading, prev = p.previous, show = fig.dataset.show, v = fig.querySelector( '.ss-figure__value' ), l = fig.querySelector( '.ss-figure__label' ), rg = fig.querySelector( '.ss-figure__range' ), t = fig.querySelector( 'time' );
			var chg = '';
			if ( show === 'buzz' ) { v.textContent = Math.round( r.buzz ); if ( prev ) chg = change( r.buzz - prev.buzz, 1 ); }
			else if ( show === 'intent' ) { v.innerHTML = people( r.intent ) + ' <span class="ss-figure__unit">people</span>'; if ( prev ) chg = change( ( r.intent - prev.intent ) / 1e5, 1, ' lakh' ); }
			else { v.innerHTML = cr( r.life_p50 ) + ' <span class="ss-figure__est">est.</span>'; if ( rg && r.life_p10 != null ) rg.textContent = 'P10 ' + cr( r.life_p10 ) + ' – P90 ' + cr( r.life_p90 ); if ( prev ) chg = change( r.life_p50 - prev.life_p50, 2, ' cr' ); }
			if ( l ) { l.innerHTML = esc( l.textContent.split( ' · ▲' )[0].split( ' · ▼' )[0].split( ' · —' )[0] ) + ( chg ? ' · ' + chg : '' ); }
			if ( t && r.recorded_at ) { var d = new Date( r.recorded_at.replace( ' ', 'T' ) + 'Z' ); t.dateTime = d.toISOString(); var parts = new Intl.DateTimeFormat( 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' } ).formatToParts( d ).reduce( function ( o, x ) { o[ x.type ] = x.value; return o; }, {} );
				var MON = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];   /* fixed: ICU says "Sept", the PHP render says "Sep" */
				t.textContent = parts.day + ' ' + MON[ +parts.month - 1 ] + ' ' + parts.year + ', ' + parts.hour + ':' + parts.minute + ' IST'; }
		} ).catch( function () { /* keep the server-rendered figure */ } );
	} );
} )();
