/* Share / copy-link buttons and the "In this story" active section. */
( function () {
	const strings = window.mjStrings || { copied: 'Link copied' };

	function flash( button, text ) {
		const original = button.textContent;
		button.textContent = text;
		setTimeout( () => { button.textContent = original; }, 1800 );
	}

	function copy( button ) {
		const url = button.dataset.url || location.href;
		if ( navigator.clipboard ) {
			navigator.clipboard.writeText( url ).then( () => flash( button, strings.copied ) );
		}
	}

	document.addEventListener( 'click', ( event ) => {
		const share = event.target.closest( '[data-mj-share]' );
		if ( share ) {
			if ( navigator.share ) {
				navigator.share( { title: share.dataset.title || document.title, url: share.dataset.url || location.href } ).catch( () => {} );
			} else {
				copy( share );
			}
			return;
		}
		const copyButton = event.target.closest( '[data-mj-copy]' );
		if ( copyButton ) {
			copy( copyButton );
		}
	} );

	const toc = document.querySelector( '.mj-toc' );
	if ( ! toc || ! ( 'IntersectionObserver' in window ) ) {
		return;
	}
	const links = new Map();
	toc.querySelectorAll( 'a[href^="#"]' ).forEach( ( a ) => {
		const target = document.getElementById( decodeURIComponent( a.hash.slice( 1 ) ) );
		if ( target ) {
			links.set( target, a );
		}
	} );
	const setCurrent = ( a ) => {
		links.forEach( ( link ) => link.removeAttribute( 'aria-current' ) );
		a.setAttribute( 'aria-current', 'location' );
	};
	const first = links.values().next().value;
	if ( first ) {
		setCurrent( first );
	}
	const observer = new IntersectionObserver( ( entries ) => {
		entries.forEach( ( entry ) => {
			if ( entry.isIntersecting ) {
				setCurrent( links.get( entry.target ) );
			}
		} );
	}, { rootMargin: '0px 0px -70% 0px' } );
	links.forEach( ( _, target ) => observer.observe( target ) );
} )();
