<form role="search" method="get" class="search-form" action="<?php echo esc_url( home_url( '/' ) ); ?>" style="display:flex;gap:8px;max-width:520px">
	<label class="screen-reader-text" for="s"><?php esc_html_e( 'Search', 'crazy4marketing' ); ?></label>
	<input class="input" type="search" id="s" name="s" value="<?php echo get_search_query(); ?>" placeholder="<?php esc_attr_e( 'Search stories', 'crazy4marketing' ); ?>">
	<button class="btn" type="submit"><?php esc_html_e( 'Go', 'crazy4marketing' ); ?></button>
</form>
