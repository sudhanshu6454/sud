<form role="search" method="get" class="search-form" action="<?php echo esc_url( home_url( '/' ) ); ?>">
	<label class="screen-reader-text" for="s"><?php esc_html_e( 'Search', 'filmybuff' ); ?></label>
	<input class="input" type="search" id="s" name="s" value="<?php echo get_search_query(); ?>" placeholder="<?php esc_attr_e( 'Search films, stars, stories', 'filmybuff' ); ?>">
	<button class="btn" type="submit"><?php esc_html_e( 'Go', 'filmybuff' ); ?></button>
</form>
