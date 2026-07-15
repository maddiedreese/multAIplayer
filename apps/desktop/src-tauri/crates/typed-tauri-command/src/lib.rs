use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, ItemFn, ReturnType, Type};

/// Declares a fallible Tauri command whose IPC error is the repository's
/// stable `CommandError` contract.
///
/// Keeping this assertion in the attribute macro makes a direct `Result`
/// return a Rust compile error instead of relying on a source-code scanner.
#[proc_macro_attribute]
pub fn command(attributes: TokenStream, item: TokenStream) -> TokenStream {
    if !attributes.is_empty() {
        return syn::Error::new(
            proc_macro2::Span::call_site(),
            "typed Tauri commands do not accept attribute arguments",
        )
        .into_compile_error()
        .into();
    }

    let function = parse_macro_input!(item as ItemFn);
    if !returns_command_result(&function.sig.output) {
        return syn::Error::new_spanned(
            &function.sig.output,
            "fallible Tauri commands must return crate::command_error::CommandResult<T>",
        )
        .into_compile_error()
        .into();
    }
    let contract_marker = function.sig.ident.clone();

    quote! {
        #[tauri::command]
        #function

        #[doc(hidden)]
        pub(crate) mod #contract_marker {
            pub(crate) const PRESENT: () = ();
        }
    }
    .into()
}

fn returns_command_result(output: &ReturnType) -> bool {
    let ReturnType::Type(_, return_type) = output else {
        return false;
    };
    let Type::Path(path) = return_type.as_ref() else {
        return false;
    };
    path.qself.is_none()
        && path.path.leading_colon.is_none()
        && path.path.segments.len() == 3
        && path.path.segments[0].ident == "crate"
        && path.path.segments[1].ident == "command_error"
        && path.path.segments[2].ident == "CommandResult"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_canonical_command_result_path() {
        let accepted: ItemFn = syn::parse_quote! {
            fn accepted() -> crate::command_error::CommandResult<()> { unimplemented!() }
        };
        let direct_result: ItemFn = syn::parse_quote! {
            fn rejected() -> Result<(), String> { unimplemented!() }
        };

        assert!(returns_command_result(&accepted.sig.output));
        assert!(!returns_command_result(&direct_result.sig.output));
        assert!(!returns_command_result(&ReturnType::Default));
    }
}
