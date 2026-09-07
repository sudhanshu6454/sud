/* Pulse Figure block — editor side. No build step: plain wp.* globals. Rendered by PHP (ServerSideRender). */
( function ( wp ) {
	var el = wp.element.createElement, useState = wp.element.useState, useEffect = wp.element.useEffect;
	var InspectorControls = wp.blockEditor.InspectorControls, useBlockProps = wp.blockEditor.useBlockProps;
	var PanelBody = wp.components.PanelBody, SelectControl = wp.components.SelectControl, TextControl = wp.components.TextControl;
	var ServerSideRender = wp.serverSideRender;
	wp.blocks.registerBlockType( 'screenstat/pulse-figure', {
		edit: function ( props ) {
			var a = props.attributes, set = props.setAttributes;
			var films = useState( [] ); var list = films[0], setList = films[1];
			useEffect( function () {
				wp.apiFetch( { path: '/sspulse/v1/films' } ).then( function ( r ) { setList( r.filter( function ( f ) { return ! f.unfilled; } ) ); } ).catch( function () { setList( [] ); } );
			}, [] );
			var options = [ { label: '— choose a film —', value: '' } ].concat( list.map( function ( f ) { return { label: f.title || f.slug, value: f.slug }; } ) );
			return el( wp.element.Fragment, null,
				el( InspectorControls, null, el( PanelBody, { title: 'Pulse figure' },
					list.length ? el( SelectControl, { label: 'Film', value: a.film, options: options, onChange: function ( v ) { set( { film: v } ); } } )
					            : el( TextControl, { label: 'Film slug', value: a.film, onChange: function ( v ) { set( { film: v } ); }, help: 'The film’s slug from the Pulse desk.' } ),
					el( SelectControl, { label: 'Show', value: a.show, options: [ { label: 'Projected collection', value: 'collection' }, { label: 'Buzz Index', value: 'buzz' }, { label: 'Ticket intent', value: 'intent' } ], onChange: function ( v ) { set( { show: v } ); } } )
				) ),
				el( 'div', useBlockProps(), a.film ? el( ServerSideRender, { block: 'screenstat/pulse-figure', attributes: a } ) : el( 'p', { className: 'ss-figure__placeholder' }, 'Pulse Figure — choose a film in the block settings.' ) )
			);
		},
		save: function () { return null; }
	} );
} )( window.wp );
