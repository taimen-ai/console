import type { ClassKey } from 'keycloakify/login'

/**
 * Классы Keycloak → классы дизайн-системы консоли. Стили Keycloak (PatternFly) выключены
 * (`doUseDefaultCss: false`): у ключа без своего класса классов нет вовсе, разметку страниц
 * ведут классы `kt-*` из `theme.css`.
 */
export const CLASSES: Partial<Record<ClassKey, string>> = {
  kcFormClass: 'kt-form',
  kcFormGroupClass: 'kt-group',
  kcLabelClass: 'kt-label',
  kcLabelWrapperClass: 'kt-label-wrap',
  kcInputWrapperClass: 'kt-input-wrap',
  kcInputClass: 'tc-input',
  kcTextareaClass: 'tc-textarea',
  kcInputGroup: 'kt-input-group',
  kcInputErrorMessageClass: 'kt-error',
  kcInputHelperTextBeforeClass: 'kt-help',
  kcInputHelperTextAfterClass: 'kt-help',
  kcCheckboxInputClass: 'kt-check',
  kcInputClassCheckboxInput: 'kt-check',
  kcCheckInputClass: 'kt-check',
  kcCheckLabelClass: 'kt-check-label',
  kcFormSettingClass: 'kt-settings',
  kcFormOptionsClass: 'kt-options',
  kcFormOptionsWrapperClass: 'kt-options',
  kcFormButtonsClass: 'kt-buttons',
  kcFormButtonsWrapperClass: 'kt-buttons',
  kcButtonClass: 'tc-btn',
  kcButtonPrimaryClass: 'tc-btn-brand',
  kcButtonSecondaryClass: 'tc-btn-secondary',
  kcButtonDefaultClass: 'tc-btn-secondary',
  kcButtonBlockClass: 'kt-block',
  kcFormPasswordVisibilityButtonClass: 'kt-reveal',
  kcFormPasswordVisibilityIconShow: 'kt-eye',
  kcFormPasswordVisibilityIconHide: 'kt-eye-off',
  kcSrOnlyClass: 'tc-sr',
  kcFormSocialAccountSectionClass: 'kt-social',
  kcFormSocialAccountListClass: 'kt-social-list',
  kcFormSocialAccountListButtonClass: 'tc-btn tc-btn-secondary kt-block',
  kcFormSocialAccountNameClass: 'kt-social-name',
  kcSelectAuthListClass: 'kt-auth-list',
  kcSelectAuthListItemClass: 'kt-auth-item',
  kcSelectAuthListItemHeadingClass: 'kt-auth-heading',
  kcSelectAuthListItemDescriptionClass: 'kt-muted',
  kcRecoveryCodesList: 'kt-codes',
  kcAlertClass: 'kt-message kt-message-warning',
}
