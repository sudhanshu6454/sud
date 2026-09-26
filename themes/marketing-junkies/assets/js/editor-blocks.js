/* Editor side of the theme's server-rendered blocks: titles and attributes come from the PHP
   registrations, the preview from the block-renderer endpoint. */
( function ( wp ) {
	const { registerBlockType, getBlockType } = wp.blocks;
	const { createElement: el } = wp.element;
	const { useBlockProps } = wp.blockEditor;
	const ServerSideRender = wp.serverSideRender;

	const names = [
		'date-strip', 'logo', 'ad-slot', 'breadcrumbs', 'sponsor-banner', 'kicker', 'byline',
		'featured-image', 'toc', 'author-bio', 'latest', 'newsletter', 'related', 'social-links', 'author-header',
	];

	names.forEach( ( slug ) => {
		const name = 'mj/' + slug;
		if ( getBlockType( name ) ) {
			return;
		}
		registerBlockType( name, {
			edit( props ) {
				const postId = props.context && props.context.postId;
				return el(
					'div',
					useBlockProps(),
					el( ServerSideRender, {
						block: name,
						attributes: props.attributes,
						urlQueryArgs: postId ? { post_id: postId } : {},
					} )
				);
			},
			save: () => null,
		} );
	} );
} )( window.wp );
